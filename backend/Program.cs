using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;

namespace PcdOnlineEditor;

// ==================== 请求/响应模型 ====================

public record PcdFileInfo(string Name, long Size, DateTime UpdateTime, string Content, int? PointCount);

// ==================== 存储服务 ====================

public class PcdStorage
{
    private readonly string _root;
    private readonly string _activeFile;
    private readonly ConcurrentDictionary<string, object> _locks = new();

    public string RootPath => _root;

    public PcdStorage(string root)
    {
        _root = root;
        Directory.CreateDirectory(root);
        _activeFile = Path.Combine(_root, ".active_map.txt");
    }

    public IEnumerable<object> List()
    {
        return Directory.GetFiles(_root, "*.pcd")
            .Select(path =>
            {
                var name = Path.GetFileNameWithoutExtension(path);
                var pcdInfo = new FileInfo(path);

                var hasPgm = File.Exists(Path.Combine(_root, name + ".pgm"));
                var hasYaml = File.Exists(Path.Combine(_root, name + ".yaml"))
                           || File.Exists(Path.Combine(_root, name + ".yml"));

                return new
                {
                    name = Path.GetFileName(path),
                    size = pcdInfo.Length,
                    pointCount = PcdHelper.ReadMetaPointCount(path),
                    updateTime = pcdInfo.LastWriteTime,
                    hasPgm,
                    hasYaml
                };
            })
            .OrderByDescending(x => x.updateTime);
    }

    public PcdFileInfo? Get(string name)
    {
        var path = GetPath(name);
        if (!File.Exists(path)) return null;
        
        var content = File.ReadAllText(path);
        return new PcdFileInfo(
            Path.GetFileName(path),
            new FileInfo(path).Length,
            File.GetLastWriteTime(path),
            content,
            PcdHelper.ParsePointCount(content)
        );
    }

    public string Save(string name, string content, int? pointCount = null)
    {
        var safeName = SafeName(name);
        if (!safeName.EndsWith(".pcd", StringComparison.OrdinalIgnoreCase))
            safeName += ".pcd";

        var path = Path.Combine(_root, safeName);
        var fileLock = _locks.GetOrAdd(safeName, _ => new object());

        lock (fileLock)
        {
            File.WriteAllText(path, content);
        }

        PcdHelper.SaveMeta(safeName, pointCount ?? PcdHelper.ParsePointCount(content));
        return safeName;
    }

    public bool Delete(string name)
    {
        var path = GetPath(name);
        if (!File.Exists(path)) return false;

        // 删除关联的pgm和yaml文件
        var baseName = Path.GetFileNameWithoutExtension(path);
        var filesToDelete = new[] { 
            path, 
            Path.Combine(_root, baseName + ".pgm"),
            Path.Combine(_root, baseName + ".yaml"),
            Path.Combine(_root, baseName + ".yml")
        };

        foreach (var file in filesToDelete)
        {
            if (File.Exists(file)) File.Delete(file);
        }

        PcdHelper.DeleteMeta(path);
        return true;
    }

    public void SetActive(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            if (File.Exists(_activeFile)) File.Delete(_activeFile);
            return;
        }
        File.WriteAllText(_activeFile, name.Trim());
    }

    public object? GetActive()
    {
        if (!File.Exists(_activeFile)) return null;
        var active = File.ReadAllText(_activeFile).Trim();
        if (string.IsNullOrEmpty(active)) return null;

        var filePath = Path.Combine(_root, active);
        if (File.Exists(filePath))
        {
            return new { hasActive = true, name = active, type = "file" };
        }
        return null;
    }

    private string GetPath(string name) => Path.Combine(_root, SafeName(name));

    private static string SafeName(string name)
    {
        var safe = Path.GetFileName(name);
        foreach (var c in Path.GetInvalidFileNameChars()) safe = safe.Replace(c, '_');
        return string.IsNullOrWhiteSpace(safe) ? $"map_{DateTime.Now:yyyyMMddHHmmss}.pcd" : safe;
    }
}

// ==================== 辅助函数 ====================

public static class PcdHelper
{
    public static int ParsePointCount(string pcdContent)
    {
        var lines = pcdContent.Split('\n');
        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (trimmed.StartsWith("points ", StringComparison.OrdinalIgnoreCase))
            {
                var parts = trimmed.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 2 && int.TryParse(parts[1], out var headerCount))
                    return headerCount;
            }
        }

        bool inData = false;
        int count = 0;
        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (trimmed.StartsWith("data", StringComparison.OrdinalIgnoreCase))
            {
                inData = true;
                continue;
            }
            if (inData && !string.IsNullOrWhiteSpace(trimmed) && !trimmed.StartsWith('#'))
                count++;
        }
        return count;
    }

    public static void SaveMeta(string pcdFilePath, int pointCount)
    {
        var metaPath = pcdFilePath.Replace(".pcd", ".meta.json");
        var meta = new { pointCount, updateTime = DateTime.Now.ToString("o") };
        File.WriteAllText(metaPath, JsonSerializer.Serialize(meta));
    }

    public static int? ReadMetaPointCount(string pcdFilePath)
    {
        var metaPath = pcdFilePath.Replace(".pcd", ".meta.json");
        if (!File.Exists(metaPath)) return null;
        try
        {
            var json = File.ReadAllText(metaPath);
            var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty("pointCount", out var pc) ? pc.GetInt32() : (int?)null;
        }
        catch
        {
            return null;
        }
    }

    public static void DeleteMeta(string pcdFilePath)
    {
        var metaPath = pcdFilePath.Replace(".pcd", ".meta.json");
        if (File.Exists(metaPath)) File.Delete(metaPath);
    }

    public static string FormatFileSize(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        if (bytes < 1024 * 1024) return $"{bytes / 1024.0:F1} KB";
        if (bytes < 1024 * 1024 * 1024) return $"{bytes / 1024.0 / 1024.0:F1} MB";
        return $"{bytes / 1024.0 / 1024.0 / 1024.0:F2} GB";
    }
}

// ==================== 程序入口 ====================

public class Program
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // 配置大文件上传支持
        builder.Services.Configure<FormOptions>(options =>
        {
            options.MultipartBodyLengthLimit = 1024L * 1024L * 1024L; // 1GB
        });

        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Limits.MaxRequestBodySize = 1024L * 1024L * 1024L; // 1GB
        });

        // 配置CORS
        builder.Services.AddCors(options =>
        {
            options.AddDefaultPolicy(policy =>
                policy.AllowAnyOrigin()
                      .AllowAnyHeader()
                      .AllowAnyMethod());
        });

        var app = builder.Build();
        app.UseCors();

        // 初始化存储服务
        var storage = new PcdStorage(Path.Combine(app.Environment.ContentRootPath, "pcd"));

        Console.WriteLine("========================================");
        Console.WriteLine("   PCD Online Editor - Backend");
        Console.WriteLine("========================================");
        Console.WriteLine($"Starting .NET API server...");
        Console.WriteLine($"URL: http://localhost:5000");
        Console.WriteLine($"Press Ctrl+C to stop");

        // ==================== API路由 ====================

        // 健康检查
        app.MapGet("/api/health", () => Results.Ok(new { status = "healthy", timestamp = DateTime.Now.ToString("o") }));

        // 获取PCD文件列表
        app.MapGet("/api/pcd", () =>
        {
            try
            {
                var list = storage.List();
                return Results.Ok(new { success = true, data = list });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] 获取列表失败: {ex.Message}");
                return Results.Problem($"获取列表失败: {ex.Message}");
            }
        });

        // 获取单个PCD文件
        app.MapGet("/api/pcd/{name}", (string name) =>
        {
            try
            {
                var item = storage.Get(name);
                return item == null
                    ? Results.NotFound(new { success = false, message = "文件不存在" })
                    : Results.Ok(new { success = true, data = item });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] 获取文件失败: {ex.Message}");
                return Results.Problem($"获取文件失败: {ex.Message}");
            }
        });

        // 上传文件（支持多文件）
        app.MapPost("/api/pcd/upload", async (HttpRequest request) =>
        {
            try
            {
                if (!request.HasFormContentType)
                    return Results.BadRequest(new { success = false, message = "请使用 multipart/form-data 上传" });

                var form = await request.ReadFormAsync();
                var files = form.Files;

                if (files.Count == 0)
                    return Results.BadRequest(new { success = false, message = "请选择文件" });

                var results = new List<object>();
                
                Console.WriteLine($"[Upload] 开始上传 {files.Count} 个文件...");

                foreach (var file in files)
                {
                    if (file == null || file.Length == 0) continue;

                    var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
                    Console.WriteLine($"[Upload] 处理: {file.FileName} ({PcdHelper.FormatFileSize(file.Length)})");

                    // 检查文件类型
                    if (!new[] { ".pcd", ".pgm", ".yaml", ".yml" }.Contains(ext))
                    {
                        results.Add(new { fileName = file.FileName, success = false, message = $"不支持的类型: {ext}" });
                        continue;
                    }

                    // 检查文件大小（100MB限制）
                    if (file.Length > 100 * 1024 * 1024)
                    {
                        results.Add(new { fileName = file.FileName, success = false, message = "文件超过100MB限制" });
                        continue;
                    }

                    try
                    {
                        await using var stream = file.OpenReadStream();
                        
                        // 大文件使用临时文件
                        if (file.Length > 10 * 1024 * 1024)
                        {
                            var tempPath = Path.GetTempFileName();
                            try
                            {
                                using var fs = new FileStream(tempPath, FileMode.Create, FileAccess.Write);
                                await stream.CopyToAsync(fs);
                                
                                var bytes = await File.ReadAllBytesAsync(tempPath);
                                ProcessFile(bytes, ext, file.FileName, results, storage);
                                Console.WriteLine($"[Upload] ✓ 已保存: {file.FileName}");
                            }
                            finally
                            {
                                if (File.Exists(tempPath)) File.Delete(tempPath);
                            }
                        }
                        else
                        {
                            using var ms = new MemoryStream();
                            await stream.CopyToAsync(ms);
                            ProcessFile(ms.ToArray(), ext, file.FileName, results, storage);
                            Console.WriteLine($"[Upload] ✓ 已保存: {file.FileName}");
                        }
                    }
                    catch (Exception fileEx)
                    {
                        Console.WriteLine($"[Upload] ✗ 失败: {file.FileName} - {fileEx.Message}");
                        results.Add(new { fileName = file.FileName, success = false, message = fileEx.Message });
                    }
                }

                var successCount = results.Count(r => r.GetType().GetProperty("success")?.GetValue(r) as bool? == true);
                Console.WriteLine($"[Upload] 完成: {successCount}/{files.Count} 成功");

                return Results.Ok(new { success = true, message = $"成功上传 {successCount} 个文件", data = results });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Upload] 严重错误: {ex.Message}");
                return Results.Problem($"上传失败: {ex.Message}");
            }
        });

        // 保存/更新PCD内容
        app.MapPost("/api/pcd/{name}", async (string name, HttpRequest request) =>
        {
            try
            {
                if (request.HasFormContentType)
                {
                    var form = await request.ReadFormAsync();
                    var file = form.Files.GetFile("file");
                    
                    if (file != null && file.Length > 0)
                    {
                        using var ms = new MemoryStream();
                        await file.CopyToAsync(ms);
                        var content = System.Text.Encoding.UTF8.GetString(ms.ToArray());
                        
                        var savedName = storage.Save(name, content);
                        return Results.Ok(new { success = true, data = storage.Get(savedName), message = "保存成功" });
                    }
                }

                using var reader = new StreamReader(request.Body);
                var text = await reader.ReadToEndAsync();
                
                if (string.IsNullOrWhiteSpace(text))
                    return Results.BadRequest(new { success = false, message = "内容不能为空" });

                var saveName = storage.Save(name, text);
                return Results.Ok(new { success = true, data = storage.Get(saveName), message = "保存成功" });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] 保存失败: {ex.Message}");
                return Results.Problem($"保存失败: {ex.Message}");
            }
        });

        // 删除PCD文件
        app.MapDelete("/api/pcd/{name}", (string name) =>
        {
            try
            {
                return storage.Delete(name)
                    ? Results.Ok(new { success = true, message = "删除成功" })
                    : Results.NotFound(new { success = false, message = "文件不存在" });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] 删除失败: {ex.Message}");
                return Results.Problem($"删除失败: {ex.Message}");
            }
        });

        // 下载文件
        app.MapGet("/api/pcd/{name}/download", (string name) =>
        {
            try
            {
                var path = Path.Combine(storage.RootPath, name);
                if (!File.Exists(path))
                    return Results.NotFound(new { success = false, message = "文件不存在" });

                var bytes = File.ReadAllBytes(path);
                return Results.File(bytes, "application/octet-stream", name);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] 下载失败: {ex.Message}");
                return Results.Problem($"下载失败: {ex.Message}");
            }
        });

        // ==================== 分组管理API ====================

        // 获取所有分组
        app.MapGet("/api/pcd/groups", () =>
        {
            try
            {
                var groupsPath = Path.Combine(storage.RootPath, "groups");
                if (!Directory.Exists(groupsPath))
                    return Results.Ok(new { success = true, data = Array.Empty<object>() });

                var groups = Directory.GetDirectories(groupsPath)
                    .Select(dir => new DirectoryInfo(dir))
                    .Where(di => di.Exists)
                    .Select(di =>
                    {
                        var groupJson = Path.Combine(di.FullName, "group.json");
                        GroupMeta? info = null;
                        
                        if (File.Exists(groupJson))
                        {
                            try
                            {
                                var json = File.ReadAllText(groupJson);
                                info = JsonSerializer.Deserialize<GroupMeta>(json);
                            }
                            catch { }
                        }

                        var pcdFiles = Directory.GetFiles(di.FullName, "*.pcd");
                        var pgmFiles = Directory.GetFiles(di.FullName, "*.pgm");
                        var yamlFiles = Directory.GetFiles(di.FullName, "*.yaml")
                            .Concat(Directory.GetFiles(di.FullName, "*.yml"))
                            .ToArray();

                        return new
                        {
                            groupId = di.Name,
                            mapName = info?.MapName ?? di.Name,
                            dateTag = info?.DateTag ?? DateTime.Now.ToString("yyyy-MM-dd"),
                            pcdFileName = pcdFiles.Length > 0 ? Path.GetFileName(pcdFiles[0]) : null,
                            pgmFileName = pgmFiles.Length > 0 ? Path.GetFileName(pgmFiles[0]) : null,
                            yamlFileName = yamlFiles.Length > 0 ? Path.GetFileName(yamlFiles[0]) : null,
                            isComplete = pcdFiles.Length > 0,
                            createdAt = di.CreationTime.ToString("yyyy-MM-dd"),
                            updatedAt = di.LastWriteTime.ToString("yyyy-MM-dd"),
                            pcdFileSize = pcdFiles.Length > 0
                                ? new FileInfo(pcdFiles[0]).Length
                                : 0,
                            pgmFileSize = pgmFiles.Length > 0
                                ? new FileInfo(pgmFiles[0]).Length 
                                : 0,
                            yamlFileSize = yamlFiles.Length > 0 
                                ? new FileInfo(yamlFiles[0]).Length 
                                : 0
                        };
                    })
                    .OrderByDescending(g => g.updatedAt);

                return Results.Ok(new { success = true, data = groups });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] 获取分组列表失败: {ex.Message}");
                return Results.Problem($"获取分组列表失败: {ex.Message}");
            }
        });

        // 获取单个分组详情
        app.MapGet("/api/pcd/groups/{groupId}", (string groupId) =>
        {
            try
            {
                var groupDir = Path.Combine(storage.RootPath, "groups", groupId);
                
                if (!Directory.Exists(groupDir))
                    return Results.NotFound(new { success = false, message = "分组不存在" });

                var files = Directory.GetFiles(groupDir);
                var pcdFile = files.FirstOrDefault(f => f.EndsWith(".pcd"));
                var pgmFile = files.FirstOrDefault(f => f.EndsWith(".pgm"));
                var yamlFile = files.FirstOrDefault(f => f.EndsWith(".yaml") || f.EndsWith(".yml"));

                var result = new
                {
                    groupId,
                    pcdFileName = pcdFile != null ? Path.GetFileName(pcdFile) : null,
                    pgmFileName = pgmFile != null ? Path.GetFileName(pgmFile) : null,
                    yamlFileName = yamlFile != null ? Path.GetFileName(yamlFile) : null,
                    isComplete = pcdFile != null,
                    pgmFileSize = pgmFile != null ? new FileInfo(pgmFile).Length : 0,
                    yamlFileSize = yamlFile != null ? new FileInfo(yamlFile).Length : 0,
                    fileCount = files.Length
                };

                return Results.Ok(new { success = true, data = result });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] 获取分组详情失败: {ex.Message}");
                return Results.Problem($"获取分组详情失败: {ex.Message}");
            }
        });

        // 创建新分组（上传时自动调用）
        app.MapPost("/api/pcd/groups", async (HttpRequest request) =>
        {
            try
            {
                using var reader = new StreamReader(request.Body);
                var body = await reader.ReadToEndAsync();
                var data = JsonSerializer.Deserialize<JsonElement>(body);

                var mapName = data.TryGetProperty("mapName", out var mn) ? mn.GetString() : $"map_{DateTime.Now:yyyyMMddHHmmss}";
                var groupId = data.TryGetProperty("groupId", out var gi) && !string.IsNullOrEmpty(gi.GetString())
                    ? gi.GetString()
                    : Guid.NewGuid().ToString("N");
                var dateTag = data.TryGetProperty("dateTag", out var dt) ? dt.GetString() ?? DateTime.Now.ToString("yyyy-MM-dd") : DateTime.Now.ToString("yyyy-MM-dd");

                var groupDir = Path.Combine(storage.RootPath, "groups", groupId);
                Directory.CreateDirectory(groupDir);

                // 保存分组信息
                var groupInfo = new GroupMeta
                {
                    MapName = mapName,
                    DateTag = dateTag,
                    CreatedAt = DateTime.Now.ToString("o"),
                    UpdatedAt = DateTime.Now.ToString("o")
                };

                var json = JsonSerializer.Serialize(groupInfo, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(Path.Combine(groupDir, "group.json"), json);

                Console.WriteLine($"[Group] 创建分组: {groupId}, 地图名: {mapName}");

                return Results.Ok(new { success = true, data = new { groupId, mapName }, message = "分组创建成功" });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] 创建分组失败: {ex.Message}");
                return Results.Problem($"创建分组失败: {ex.Message}");
            }
        });

        // 上传文件到指定分组
        app.MapPost("/api/pcd/groups/{groupId}/files", async (string groupId, HttpRequest request) =>
        {
            try
            {
                var groupDir = Path.Combine(storage.RootPath, "groups", groupId);
                
                if (!Directory.Exists(groupDir))
                    Directory.CreateDirectory(groupDir);

                if (!request.HasFormContentType)
                    return Results.BadRequest(new { success = false, message = "请使用 multipart/form-data" });

                var form = await request.ReadFormAsync();
                var files = form.Files;

                if (files.Count == 0)
                    return Results.BadRequest(new { success = false, message = "请选择文件" });

                var results = new List<object>();

                foreach (var file in files)
                {
                    if (file == null || file.Length == 0) continue;

                    var targetPath = Path.Combine(groupDir, file.FileName);
                    
                    await using var stream = file.OpenReadStream();
                    using var fs = new FileStream(targetPath, FileMode.Create);
                    await stream.CopyToAsync(fs);

                    results.Add(new { fileName = file.FileName, success = true, size = file.Length });
                    Console.WriteLine($"[Group] 文件已上传到分组 {groupId}: {file.FileName} ({PcdHelper.FormatFileSize(file.Length)})");
                }

                // 更新分组的更新时间
                var groupJson = Path.Combine(groupDir, "group.json");
                if (File.Exists(groupJson))
                {
                    try
                    {
                        var existingJson = File.ReadAllText(groupJson);
                        var info = JsonSerializer.Deserialize<GroupMeta>(existingJson);
                        if (info != null)
                        {
                            info.UpdatedAt = DateTime.Now.ToString("o");
                            File.WriteAllText(groupJson, JsonSerializer.Serialize(info));
                        }
                    }
                    catch { }
                }

                return Results.Ok(new { success = true, data = results, message = $"成功上传 {results.Count} 个文件到分组" });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] 上传文件到分组失败: {ex.Message}");
                return Results.Problem($"上传文件到分组失败: {ex.Message}");
            }
        });

        // 下载分组中的文件
        app.MapGet("/api/pcd/groups/{groupId}/files/{fileType}", (string groupId, string fileType) =>
        {
            try
            {
                var groupDir = Path.Combine(storage.RootPath, "groups", groupId);
                if (!Directory.Exists(groupDir))
                    return Results.NotFound(new { success = false, message = "分组不存在" });

                // fileType: "pointcloud" -> *.pcd, "occupancy" -> *.pgm, "yaml" -> *.yaml
                var ext = fileType == "pointcloud" ? ".pcd" : fileType == "occupancy" ? ".pgm" : ".yaml";
                var files = Directory.GetFiles(groupDir, $"*{ext}");
                if (files.Length == 0)
                    return Results.NotFound(new { success = false, message = $"分组中没有 {fileType} 文件" });

                var filePath = files[0];
                var bytes = File.ReadAllBytes(filePath);
                var base64 = Convert.ToBase64String(bytes);
                return Results.Ok(new { success = true, data = new { fileName = Path.GetFileName(filePath), base64Data = base64, size = bytes.Length } });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] 下载分组文件失败: {ex.Message}");
                return Results.Problem($"下载文件失败: {ex.Message}");
            }
        });

        // 删除分组
        app.MapDelete("/api/pcd/groups/{groupId}", (string groupId) =>
        {
            try
            {
                var groupDir = Path.Combine(storage.RootPath, "groups", groupId);
                
                if (!Directory.Exists(groupDir))
                    return Results.NotFound(new { success = false, message = "分组不存在" });

                // 删除整个目录及其内容
                Directory.Delete(groupDir, recursive: true);

                Console.WriteLine($"[Group] 已删除分组: {groupId}");
                return Results.Ok(new { success = true, message = "分组删除成功" });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] 删除分组失败: {ex.Message}");
                return Results.Problem($"删除分组失败: {ex.Message}");
            }
        });

        // 设置当前激活的地图
        app.MapPost("/api/pcd/active", async (HttpRequest request) =>
        {
            try
            {
                using var reader = new StreamReader(request.Body);
                var body = await reader.ReadToEndAsync();
                var data = JsonSerializer.Deserialize<JsonElement>(body);
                
                var name = data.TryGetProperty("name", out var n) ? n.GetString() : null;
                storage.SetActive(name);
                
                return Results.Ok(new { success = true, message = "设置成功" });
            }
            catch (Exception ex)
            {
                return Results.Problem(ex.Message);
            }
        });

        // 获取当前激活的地图
        app.MapGet("/api/pcd/active", () =>
        {
            try
            {
                var active = storage.GetActive();
                return Results.Ok(new { success = true, data = active });
            }
            catch (Exception ex)
            {
                return Results.Problem(ex.Message);
            }
        });

        // ==================== 兼容原项目建图管理 PCD-only API ====================

        app.MapGet("/api/dispatch/agv/mapping/import/list", () =>
        {
            try
            {
                var items = storage.List();
                return Results.Ok(new { success = true, code = 0, message = "success", data = new { items, total = items.Count() } });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, code = 500, message = ex.Message, data = new { items = Array.Empty<object>(), total = 0 } });
            }
        });

        app.MapPost("/api/dispatch/agv/mapping/import/bundle", async (HttpRequest request) =>
        {
            try
            {
                if (!request.HasFormContentType)
                    return Results.BadRequest(new { success = false, code = 400, message = "请使用 multipart/form-data 上传" });

                var form = await request.ReadFormAsync();
                var files = form.Files;
                if (files.Count == 0)
                    return Results.BadRequest(new { success = false, code = 400, message = "请选择文件" });

                var mapName = form["mapName"].FirstOrDefault();
                if (string.IsNullOrWhiteSpace(mapName))
                {
                    var firstPcd = files.FirstOrDefault(f => Path.GetExtension(f.FileName).Equals(".pcd", StringComparison.OrdinalIgnoreCase));
                    mapName = firstPcd != null ? Path.GetFileNameWithoutExtension(firstPcd.FileName) : $"map_{DateTime.Now:yyyyMMddHHmmss}";
                }
                var groupId = form["groupId"].FirstOrDefault();
                if (string.IsNullOrWhiteSpace(groupId)) groupId = Guid.NewGuid().ToString("N");
                var dateTag = form["dateTag"].FirstOrDefault() ?? DateTime.Now.ToString("yyyy-MM-dd");

                var groupDir = Path.Combine(storage.RootPath, "groups", groupId);
                Directory.CreateDirectory(groupDir);

                var groupInfo = new GroupMeta
                {
                    GroupId = groupId,
                    MapName = mapName,
                    DateTag = dateTag,
                    CreatedAt = DateTime.Now.ToString("o"),
                    UpdatedAt = DateTime.Now.ToString("o")
                };
                await File.WriteAllTextAsync(Path.Combine(groupDir, "group.json"), JsonSerializer.Serialize(groupInfo, new JsonSerializerOptions { WriteIndented = true }));

                var results = new List<object>();
                foreach (var file in files)
                {
                    if (file.Length == 0) continue;
                    var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
                    if (!new[] { ".pcd", ".pgm", ".yaml", ".yml" }.Contains(ext)) continue;

                    var safeName = Path.GetFileName(file.FileName);
                    var targetPath = Path.Combine(groupDir, safeName);
                    await using (var input = file.OpenReadStream())
                    await using (var output = new FileStream(targetPath, FileMode.Create, FileAccess.Write))
                    {
                        await input.CopyToAsync(output);
                    }

                    if (ext == ".pcd")
                    {
                        var bytes = await File.ReadAllBytesAsync(targetPath);
                        var text = System.Text.Encoding.UTF8.GetString(bytes);
                        storage.Save(safeName, text, PcdHelper.ParsePointCount(text));
                    }

                    results.Add(new { fileName = safeName, success = true, size = file.Length });
                }

                return Results.Ok(new { success = true, code = 0, message = "导入成功", data = new { groupId, id = groupId, mapName, files = results } });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, code = 500, message = ex.Message });
            }
        });

        app.MapGet("/api/dispatch/agv/mapping/pointcloud/groups", () =>
        {
            var groupsPath = Path.Combine(storage.RootPath, "groups");
            if (!Directory.Exists(groupsPath))
                return Results.Ok(new { success = true, code = 0, message = "success", data = new { total = 0, items = Array.Empty<object>() } });

            var items = Directory.GetDirectories(groupsPath)
                .Select(dir => new DirectoryInfo(dir))
                .Select(di =>
                {
                    var groupJson = Path.Combine(di.FullName, "group.json");
                    GroupMeta? info = null;
                    if (File.Exists(groupJson))
                    {
                        try { info = JsonSerializer.Deserialize<GroupMeta>(File.ReadAllText(groupJson)); } catch { }
                    }
                    var pcdFiles = Directory.GetFiles(di.FullName, "*.pcd");
                    var pgmFiles = Directory.GetFiles(di.FullName, "*.pgm");
                    var yamlFiles = Directory.GetFiles(di.FullName, "*.yaml").Concat(Directory.GetFiles(di.FullName, "*.yml")).ToArray();
                    return new
                    {
                        groupId = di.Name,
                        mapName = info?.MapName ?? di.Name,
                        dateTag = info?.DateTag ?? DateTime.Now.ToString("yyyy-MM-dd"),
                        pcdFileName = pcdFiles.Length > 0 ? Path.GetFileName(pcdFiles[0]) : null,
                        pgmFileName = pgmFiles.Length > 0 ? Path.GetFileName(pgmFiles[0]) : null,
                        yamlFileName = yamlFiles.Length > 0 ? Path.GetFileName(yamlFiles[0]) : null,
                        isComplete = pcdFiles.Length > 0,
                        createdAt = info?.CreatedAt ?? di.CreationTime.ToString("o"),
                        updatedAt = info?.UpdatedAt ?? di.LastWriteTime.ToString("o"),
                        pcdFileSize = pcdFiles.Length > 0 ? new FileInfo(pcdFiles[0]).Length : 0,
                        pgmFileSize = pgmFiles.Length > 0 ? new FileInfo(pgmFiles[0]).Length : 0,
                        yamlFileSize = yamlFiles.Length > 0 ? new FileInfo(yamlFiles[0]).Length : 0
                    };
                })
                .OrderByDescending(g => g.updatedAt)
                .ToArray();

            return Results.Ok(new { success = true, code = 0, message = "success", data = new { total = items.Length, items } });
        });

        app.MapGet("/api/dispatch/agv/mapping/pointcloud/groups/{groupId}", (string groupId) =>
        {
            var groupDir = Path.Combine(storage.RootPath, "groups", groupId);
            if (!Directory.Exists(groupDir)) return Results.NotFound(new { success = false, code = 404, message = "分组不存在" });
            var files = Directory.GetFiles(groupDir)
                .Where(f => new[] { ".pcd", ".pgm", ".yaml", ".yml" }.Contains(Path.GetExtension(f).ToLowerInvariant()))
                .Select(f => new
                {
                    fileType = Path.GetExtension(f).ToLowerInvariant() == ".pcd" ? "pointcloud" : Path.GetExtension(f).ToLowerInvariant() == ".pgm" ? "occupancy" : "yaml",
                    fileName = Path.GetFileName(f),
                    fileSize = new FileInfo(f).Length,
                    status = "saved",
                    lastModified = File.GetLastWriteTime(f).ToString("o")
                })
                .ToArray();
            var groupJson = Path.Combine(groupDir, "group.json");
            GroupMeta? info = File.Exists(groupJson) ? JsonSerializer.Deserialize<GroupMeta>(File.ReadAllText(groupJson)) : null;
            return Results.Ok(new { success = true, code = 0, message = "success", data = new { groupId, mapName = info?.MapName ?? groupId, dateTag = info?.DateTag, files } });
        });

        app.MapDelete("/api/dispatch/agv/mapping/pointcloud/groups/{groupId}", (string groupId) =>
        {
            var groupDir = Path.Combine(storage.RootPath, "groups", groupId);
            if (!Directory.Exists(groupDir)) return Results.NotFound(new { success = false, code = 404, message = "分组不存在" });
            Directory.Delete(groupDir, true);
            return Results.Ok(new { success = true, code = 0, message = "删除成功", data = (object?)null });
        });

        app.MapGet("/api/dispatch/agv/mapping/pointcloud/download/{id}", (string id, string fileType) =>
        {
            var groupDir = Path.Combine(storage.RootPath, "groups", id);
            string? filePath = null;
            if (Directory.Exists(groupDir))
            {
                var pattern = fileType == "pointcloud" ? "*.pcd" : fileType == "occupancy" ? "*.pgm" : "*.yaml";
                filePath = Directory.GetFiles(groupDir, pattern).FirstOrDefault();
                if (filePath == null && fileType == "yaml") filePath = Directory.GetFiles(groupDir, "*.yml").FirstOrDefault();
            }
            else if (fileType == "pointcloud")
            {
                filePath = Path.Combine(storage.RootPath, id.EndsWith(".pcd", StringComparison.OrdinalIgnoreCase) ? id : id + ".pcd");
            }
            if (filePath == null || !File.Exists(filePath)) return Results.NotFound(new { success = false, code = 404, message = "文件不存在" });
            var bytes = File.ReadAllBytes(filePath);
            return Results.Ok(new { success = true, code = 0, message = "success", data = new { base64Data = Convert.ToBase64String(bytes), md5 = string.Empty, fileType, fileName = Path.GetFileName(filePath) } });
        });

        app.MapPost("/api/dispatch/agv/mapping/pointcloud/save/{id}", async (string id, HttpRequest request) =>
        {
            if (!request.HasFormContentType) return Results.BadRequest(new { success = false, code = 400, message = "请使用 multipart/form-data" });
            var form = await request.ReadFormAsync();
            var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
            var fileType = form["fileType"].FirstOrDefault() ?? "pointcloud";
            var mapName = form["mapName"].FirstOrDefault() ?? id;
            if (file == null || file.Length == 0) return Results.BadRequest(new { success = false, code = 400, message = "请选择文件" });
            var groupDir = Path.Combine(storage.RootPath, "groups", id);
            Directory.CreateDirectory(groupDir);
            var groupJson = Path.Combine(groupDir, "group.json");
            GroupMeta? info = null;
            if (File.Exists(groupJson))
            {
                try { info = JsonSerializer.Deserialize<GroupMeta>(await File.ReadAllTextAsync(groupJson)); } catch { }
            }
            info ??= new GroupMeta { GroupId = id, CreatedAt = DateTime.Now.ToString("o") };
            info.MapName = mapName;
            info.DateTag = string.IsNullOrWhiteSpace(info.DateTag) ? DateTime.Now.ToString("yyyy-MM-dd") : info.DateTag;
            info.UpdatedAt = DateTime.Now.ToString("o");
            await File.WriteAllTextAsync(groupJson, JsonSerializer.Serialize(info, new JsonSerializerOptions { WriteIndented = true }));
            var targetPath = Path.Combine(groupDir, Path.GetFileName(file.FileName));
            await using (var input = file.OpenReadStream())
            await using (var output = new FileStream(targetPath, FileMode.Create, FileAccess.Write))
            {
                await input.CopyToAsync(output);
            }
            if (fileType == "pointcloud" || Path.GetExtension(file.FileName).Equals(".pcd", StringComparison.OrdinalIgnoreCase))
            {
                var text = await File.ReadAllTextAsync(targetPath);
                storage.Save(file.FileName, text, PcdHelper.ParsePointCount(text));
            }
            return Results.Ok(new { success = true, code = 0, message = "保存成功", data = new { groupId = id, fileName = file.FileName, fileType, updatedAt = DateTime.Now.ToString("o") } });
        });

        app.MapDelete("/api/dispatch/agv/mapping/import/delete/{name}", (string name) =>
        {
            var ok = storage.Delete(name);
            return ok ? Results.Ok(new { success = true, code = 0, message = "删除成功" }) : Results.NotFound(new { success = false, code = 404, message = "文件不存在" });
        });

        app.MapPost("/api/dispatch/agv/mapping/import/save/{name}", async (string name, HttpRequest request) =>
        {
            try
            {
                if (!request.HasFormContentType)
                    return Results.BadRequest(new { success = false, code = 400, message = "请使用 multipart/form-data" });

                var form = await request.ReadFormAsync();
                var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
                var fileType = form["fileType"].FirstOrDefault() ?? "pointcloud";
                if (file == null || file.Length == 0)
                    return Results.BadRequest(new { success = false, code = 400, message = "请选择文件" });

                var safeBaseName = Path.GetFileNameWithoutExtension(name);
                if (string.IsNullOrWhiteSpace(safeBaseName)) safeBaseName = Path.GetFileNameWithoutExtension(file.FileName);
                foreach (var c in Path.GetInvalidFileNameChars()) safeBaseName = safeBaseName.Replace(c, '_');

                var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
                if (fileType == "pointcloud" || ext == ".pcd")
                {
                    using var reader = new StreamReader(file.OpenReadStream());
                    var content = await reader.ReadToEndAsync();
                    var savedName = storage.Save(safeBaseName + ".pcd", content, PcdHelper.ParsePointCount(content));
                    return Results.Ok(new { success = true, code = 0, message = "保存成功", data = new { fileName = savedName, path = Path.Combine(storage.RootPath, savedName) } });
                }

                var targetExt = fileType == "occupancy" ? ".pgm" : ".yaml";
                var targetPath = Path.Combine(storage.RootPath, safeBaseName + targetExt);
                await using (var input = file.OpenReadStream())
                await using (var output = new FileStream(targetPath, FileMode.Create, FileAccess.Write))
                {
                    await input.CopyToAsync(output);
                }
                return Results.Ok(new { success = true, code = 0, message = "保存成功", data = new { fileName = Path.GetFileName(targetPath), path = targetPath } });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, code = 500, message = ex.Message });
            }
        });

        app.MapPost("/api/dispatch/agv/mapping/import/activate/{name}", (string name) =>
        {
            storage.SetActive(name);
            return Results.Ok(new { success = true, code = 0, message = "设置成功", data = new { mapName = name, isActive = true } });
        });

        // ==================== 非 PCD 请求静默处理（避免 404 刷屏） ====================
        app.Use(async (context, next) => {
            await next();
            if (context.Response.StatusCode == 404
                && context.Request.Path.StartsWithSegments("/api")
                && !context.Request.Path.StartsWithSegments("/api/pcd")
                && !context.Request.Path.StartsWithSegments("/api/health"))
            {
                context.Response.StatusCode = 200;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync("{\"success\":true,\"data\":[]}");
            }
        });

        // 启动应用
        app.Run();
    }

    // 处理单个文件的辅助方法
    private static void ProcessFile(byte[] bytes, string ext, string fileName, List<object> results, PcdStorage storage)
    {
        if (ext == ".pcd")
        {
            var text = System.Text.Encoding.UTF8.GetString(bytes);
            int pointCount = PcdHelper.ParsePointCount(text);
            var savedName = storage.Save(fileName, text, pointCount);
            var savedFile = storage.Get(savedName);
            
            results.Add(new { 
                fileName, 
                savedName, 
                success = true, 
                data = savedFile,
                message = "上传成功"
            });
        }
        else
        {
            // 非PCD文件直接保存
            var safeName = Path.GetFileName(fileName);
            foreach (var c in Path.GetInvalidFileNameChars())
                safeName = safeName.Replace(c, '_');
            
            var targetPath = Path.Combine(storage.RootPath, safeName);
            File.WriteAllBytes(targetPath, bytes);
            
            results.Add(new { 
                fileName, 
                success = true, 
                message = $"{fileName} 上传成功"
            });
        }
    }
}

// ==================== 分组元数据模型 ====================

public class GroupMeta
{
    public string GroupId { get; set; } = string.Empty;
    public string MapName { get; set; } = string.Empty;
    public string DateTag { get; set; } = string.Empty;
    public string CreatedAt { get; set; } = string.Empty;
    public string UpdatedAt { get; set; } = string.Empty;
}
