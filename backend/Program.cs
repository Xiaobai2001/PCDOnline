using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;

var builder = WebApplication.CreateBuilder(args);
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 1024L * 1024L * 1024L;
});
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 1024L * 1024L * 1024L;
});
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
});

var app = builder.Build();
app.UseCors();

var storage = new PcdStorage(Path.Combine(app.Environment.ContentRootPath, "PcdFiles"));

app.MapGet("/api/pcd", () => Results.Ok(storage.List()));

app.MapGet("/api/pcd/{name}", (string name) =>
{
    var item = storage.Get(name);
    return item == null ? Results.NotFound(new { message = "文件不存在" }) : Results.Ok(item);
});

app.MapPost("/api/pcd/upload", async (HttpRequest request) =>
{
    if (!request.HasFormContentType) return Results.BadRequest(new { message = "请使用 multipart/form-data 上传" });
    var form = await request.ReadFormAsync();
    var file = form.Files.GetFile("file");
    if (file == null || file.Length == 0) return Results.BadRequest(new { message = "请选择 PCD 文件" });
    if (!Path.GetExtension(file.FileName).Equals(".pcd", StringComparison.OrdinalIgnoreCase))
    {
        return Results.BadRequest(new { message = "只支持 .pcd 文件" });
    }

    await using var stream = file.OpenReadStream();
    using var ms = new MemoryStream();
    await stream.CopyToAsync(ms);
    var text = System.Text.Encoding.UTF8.GetString(ms.ToArray());
    var name = storage.Save(file.FileName, text);
    return Results.Ok(storage.Get(name));
});

app.MapPut("/api/pcd/{name}", async (string name, SavePcdRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.Content)) return Results.BadRequest(new { message = "PCD 内容不能为空" });
    var savedName = storage.Save(name, request.Content);
    return Results.Ok(storage.Get(savedName));
});

app.MapDelete("/api/pcd/{name}", (string name) =>
{
    return storage.Delete(name) ? Results.Ok(new { message = "删除成功" }) : Results.NotFound(new { message = "文件不存在" });
});

app.Run("http://0.0.0.0:5088");

record SavePcdRequest(string Content);
record PcdFileInfo(string Name, long Size, DateTime UpdateTime, string Content);

class PcdStorage
{
    private readonly string _root;
    private readonly ConcurrentDictionary<string, object> _locks = new();

    public PcdStorage(string root)
    {
        _root = root;
        Directory.CreateDirectory(_root);
    }

    public IEnumerable<object> List()
    {
        return Directory.GetFiles(_root, "*.pcd")
            .Select(path => new
            {
                name = Path.GetFileName(path),
                size = new FileInfo(path).Length,
                updateTime = File.GetLastWriteTime(path)
            })
            .OrderByDescending(x => x.updateTime);
    }

    public PcdFileInfo? Get(string name)
    {
        var path = GetPath(name);
        if (!File.Exists(path)) return null;
        return new PcdFileInfo(Path.GetFileName(path), new FileInfo(path).Length, File.GetLastWriteTime(path), File.ReadAllText(path));
    }

    public string Save(string name, string content)
    {
        var safeName = SafeName(name);
        if (!safeName.EndsWith(".pcd", StringComparison.OrdinalIgnoreCase)) safeName += ".pcd";
        var path = Path.Combine(_root, safeName);
        var fileLock = _locks.GetOrAdd(safeName, _ => new object());
        lock (fileLock)
        {
            File.WriteAllText(path, content);
        }
        return safeName;
    }

    public bool Delete(string name)
    {
        var path = GetPath(name);
        if (!File.Exists(path)) return false;
        File.Delete(path);
        return true;
    }

    private string GetPath(string name) => Path.Combine(_root, SafeName(name));

    private static string SafeName(string name)
    {
        var safe = Path.GetFileName(name);
        foreach (var c in Path.GetInvalidFileNameChars()) safe = safe.Replace(c, '_');
        return string.IsNullOrWhiteSpace(safe) ? $"map_{DateTime.Now:yyyyMMddHHmmss}.pcd" : safe;
    }
}
