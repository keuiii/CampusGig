using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace CampusGig.Mobile.Services;

public sealed class CampusGigApi
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(25) };
    private readonly SessionService session;

    public CampusGigApi(SessionService session)
    {
        this.session = session;
    }

    public string BaseUrl
    {
        get
        {
            var defaultUrl = DeviceInfo.Platform == DevicePlatform.Android
                ? "http://10.0.2.2:4000/api/v1"
                : "http://localhost:4000/api/v1";
            return Preferences.Default.Get("campusgig_api_url", defaultUrl).TrimEnd('/');
        }
    }

    public Task<T> GetAsync<T>(string path) => SendAsync<T>(HttpMethod.Get, path, null);

    public Task<T?> GetOptionalAsync<T>(string path) where T : class =>
        SendOptionalAsync<T>(HttpMethod.Get, path);

    public Task<TResponse> PostAsync<TResponse>(string path, object? body = null) =>
        SendAsync<TResponse>(HttpMethod.Post, path, body);

    public Task<TResponse> PutAsync<TResponse>(string path, object? body = null) =>
        SendAsync<TResponse>(HttpMethod.Put, path, body);

    public Task<TResponse> PatchAsync<TResponse>(string path, object? body = null) =>
        SendAsync<TResponse>(HttpMethod.Patch, path, body);

    public Task<TResponse> DeleteAsync<TResponse>(string path) =>
        SendAsync<TResponse>(HttpMethod.Delete, path, null);

    public Task<TResponse> PostMultipartAsync<TResponse>(
        string path,
        IReadOnlyDictionary<string, string?> fields,
        IReadOnlyList<ApiUpload> files) => SendMultipartAsync<TResponse>(path, fields, files);

    public static event Func<Task>? UnauthorizedReceived;

    public async Task<string> DownloadAsync(string path, string fileName)
    {
        using var request = CreateRequest(HttpMethod.Get, path);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
        if (!response.IsSuccessStatusCode)
            await HandleFailureAsync(response, await response.Content.ReadAsStringAsync(), request.Headers.Authorization is not null);

        var safeName = string.Concat(fileName.Select(character =>
            Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));
        var destination = Path.Combine(FileSystem.CacheDirectory, safeName);
        await using var input = await response.Content.ReadAsStreamAsync();
        await using var output = File.Create(destination);
        await input.CopyToAsync(output);
        return destination;
    }

    private async Task<T> SendAsync<T>(HttpMethod method, string path, object? body)
    {
        using var request = CreateRequest(method, path);
        if (body is not null)
        {
            var json = JsonSerializer.Serialize(body, JsonOptions);
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        using var response = await http.SendAsync(request);
        var content = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
            await HandleFailureAsync(response, content, request.Headers.Authorization is not null);

        if (typeof(T) == typeof(ApiEmpty)) return (T)(object)new ApiEmpty();
        var payload = JsonSerializer.Deserialize<T>(content, JsonOptions);
        return payload ?? throw new CampusGigApiException("The server returned an empty response.");
    }

    private async Task<T?> SendOptionalAsync<T>(HttpMethod method, string path) where T : class
    {
        using var request = CreateRequest(method, path);
        using var response = await http.SendAsync(request);
        var content = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
            await HandleFailureAsync(response, content, request.Headers.Authorization is not null);

        if (ApiPayloadRules.IsEmptyOptionalPayload(content)) return null;
        return JsonSerializer.Deserialize<T>(content, JsonOptions)
            ?? throw new CampusGigApiException("The server returned an invalid optional response.");
    }

    private async Task<T> SendMultipartAsync<T>(
        string path,
        IReadOnlyDictionary<string, string?> fields,
        IReadOnlyList<ApiUpload> files)
    {
        using var request = CreateRequest(HttpMethod.Post, path);
        using var form = new MultipartFormDataContent();
        foreach (var field in fields.Where(field => field.Value is not null))
            form.Add(new StringContent(field.Value!), field.Key);
        foreach (var file in files)
        {
            var stream = await file.OpenReadAsync();
            var content = new StreamContent(stream);
            content.Headers.ContentType = new MediaTypeHeaderValue(file.ContentType);
            form.Add(content, file.FieldName, file.FileName);
        }
        request.Content = form;
        using var response = await http.SendAsync(request);
        var contentText = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
            await HandleFailureAsync(response, contentText, request.Headers.Authorization is not null);
        if (typeof(T) == typeof(ApiEmpty)) return (T)(object)new ApiEmpty();
        return JsonSerializer.Deserialize<T>(contentText, JsonOptions)
            ?? throw new CampusGigApiException("The server returned an empty response.");
    }

    private async Task HandleFailureAsync(HttpResponseMessage response, string content, bool requestHadBearerToken)
    {
        if (AuthorizationFailureRules.ShouldClearSession(response.StatusCode, requestHadBearerToken))
        {
            await session.ClearAccessSessionAsync();
            if (UnauthorizedReceived is not null)
            {
                await MainThread.InvokeOnMainThreadAsync(async () =>
                {
                    try { await UnauthorizedReceived.Invoke(); } catch { }
                });
            }
        }
        throw new CampusGigApiException(ReadError(content, response.ReasonPhrase));
    }

    private HttpRequestMessage CreateRequest(HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, $"{BaseUrl}/{path.TrimStart('/')}");
        if (!string.IsNullOrWhiteSpace(session.AccessToken))
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        return request;
    }

    private static string ReadError(string content, string? fallback)
    {
        try
        {
            using var document = JsonDocument.Parse(content);
            if (document.RootElement.TryGetProperty("message", out var message))
            {
                if (message.ValueKind == JsonValueKind.String)
                    return message.GetString() ?? "Unable to continue.";
                if (message.ValueKind == JsonValueKind.Array)
                    return string.Join(Environment.NewLine, message.EnumerateArray().Select(x => x.GetString()));
            }
        }
        catch (JsonException)
        {
        }
        return fallback ?? "Unable to connect to CampusGig.";
    }
}

public sealed class ApiEmpty;

public sealed record ApiUpload(
    string FieldName,
    string FileName,
    string ContentType,
    Func<Task<Stream>> OpenReadAsync);

public sealed class CampusGigApiException(string message) : Exception(message);
