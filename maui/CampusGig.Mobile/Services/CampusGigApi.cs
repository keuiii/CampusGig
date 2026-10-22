using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Services;

public sealed class CampusGigApi
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(25) };
    private readonly HttpClient transferHttp = new() { Timeout = TimeSpan.FromMinutes(2) };
    private readonly SessionService session;
    private readonly SemaphoreSlim refreshGate = new(1, 1);
    private int unauthorizedSignalActive;

    public CampusGigApi(SessionService session)
    {
        this.session = session;
    }

    public string BaseUrl
    {
        get
        {
            var defaultUrl = ApiEndpointRules.Resolve(
                ApiEndpointRules.ConfiguredBuildUrl(),
                DeviceInfo.Platform == DevicePlatform.Android,
                DeviceInfo.DeviceType == DeviceType.Virtual,
#if DEBUG
                requireHttps: false);
            return Preferences.Default.Get("campusgig_api_url", defaultUrl).TrimEnd('/');
#else
                requireHttps: true);
            return defaultUrl;
#endif
        }
    }

    public Task<T> GetAsync<T>(string path) => SendAsync<T>(HttpMethod.Get, path, null);

    public Task<T> GetAsync<T>(string path, CancellationToken cancellationToken) =>
        SendAsync<T>(HttpMethod.Get, path, null, cancellationToken);

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
        HttpResponseMessage? response = null;
        var apiBaseUri = new Uri(BaseUrl);
        for (var attempt = 0; attempt < 2; attempt++)
        {
            using var request = CreateRequest(HttpMethod.Get, path);
            var accessToken = session.AccessToken;
            response = await transferHttp.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
            if (response.StatusCode != System.Net.HttpStatusCode.Unauthorized || attempt > 0 ||
                !await TryRefreshSessionAsync(accessToken))
            {
                if (!DownloadRetryRules.ShouldRenewSignedUrl(
                    response.StatusCode,
                    response.RequestMessage?.RequestUri,
                    apiBaseUri,
                    attempt)) break;
            }
            response.Dispose();
            response = null;
        }
        using var finalResponse = response ?? throw new CampusGigApiException("The server returned no response.");
        if (!finalResponse.IsSuccessStatusCode)
            await HandleFailureAsync(finalResponse, await finalResponse.Content.ReadAsStringAsync(), true);

        var safeName = string.Concat(fileName.Select(character =>
            Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));
        if (string.IsNullOrWhiteSpace(safeName)) safeName = "campusgig-download";
        var destination = Path.Combine(FileSystem.CacheDirectory, $"{Guid.NewGuid():N}-{safeName}");
        var partial = $"{destination}.part";
        try
        {
            await using var input = await finalResponse.Content.ReadAsStreamAsync();
            await using (var output = File.Create(partial))
                await input.CopyToAsync(output);
            var expectedBytes = finalResponse.Content.Headers.ContentLength;
            if (expectedBytes.HasValue && new FileInfo(partial).Length != expectedBytes.Value)
                throw new IOException("The downloaded file was incomplete.");
            File.Move(partial, destination, true);
            return destination;
        }
        catch
        {
            try { File.Delete(partial); } catch { }
            throw;
        }
    }

    private async Task<T> SendAsync<T>(
        HttpMethod method,
        string path,
        object? body,
        CancellationToken cancellationToken = default)
    {
        var json = body is null ? null : JsonSerializer.Serialize(body, JsonOptions);
        for (var attempt = 0; attempt < 2; attempt++)
        {
            using var request = CreateRequest(method, path);
            var accessToken = session.AccessToken;
            if (json is not null)
                request.Content = new StringContent(json, Encoding.UTF8, "application/json");
            using var response = await http.SendAsync(request, cancellationToken);
            var content = await response.Content.ReadAsStringAsync(cancellationToken);
            if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized && attempt == 0 &&
                await TryRefreshSessionAsync(accessToken)) continue;
            if (!response.IsSuccessStatusCode)
                await HandleFailureAsync(response, content, request.Headers.Authorization is not null);

            if (typeof(T) == typeof(ApiEmpty)) return (T)(object)new ApiEmpty();
            var payload = JsonSerializer.Deserialize<T>(content, JsonOptions);
            return payload ?? throw new CampusGigApiException("The server returned an empty response.");
        }
        throw new CampusGigApiException("Unable to renew the session.");
    }

    private async Task<T?> SendOptionalAsync<T>(HttpMethod method, string path) where T : class
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            using var request = CreateRequest(method, path);
            var accessToken = session.AccessToken;
            using var response = await http.SendAsync(request);
            var content = await response.Content.ReadAsStringAsync();
            if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized && attempt == 0 &&
                await TryRefreshSessionAsync(accessToken)) continue;
            if (!response.IsSuccessStatusCode)
                await HandleFailureAsync(response, content, request.Headers.Authorization is not null);
            if (ApiPayloadRules.IsEmptyOptionalPayload(content)) return null;
            return JsonSerializer.Deserialize<T>(content, JsonOptions)
                ?? throw new CampusGigApiException("The server returned an invalid optional response.");
        }
        throw new CampusGigApiException("Unable to renew the session.");
    }

    private async Task<T> SendMultipartAsync<T>(
        string path,
        IReadOnlyDictionary<string, string?> fields,
        IReadOnlyList<ApiUpload> files)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            using var request = CreateRequest(HttpMethod.Post, path);
            var accessToken = session.AccessToken;
            using var form = new MultipartFormDataContent();
            foreach (var field in fields.Where(field => field.Value is not null))
                form.Add(new StringContent(field.Value!), field.Key);
            foreach (var file in files)
            {
                await using var stream = await file.OpenReadAsync();
                using var memory = new MemoryStream();
                await stream.CopyToAsync(memory);
                var fileContent = new ByteArrayContent(memory.ToArray());
                fileContent.Headers.ContentType = new MediaTypeHeaderValue(file.ContentType);
                form.Add(fileContent, file.FieldName, file.FileName);
            }
            request.Content = form;
            using var response = await transferHttp.SendAsync(request);
            var contentText = await response.Content.ReadAsStringAsync();
            if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized && attempt == 0 &&
                await TryRefreshSessionAsync(accessToken)) continue;
            if (!response.IsSuccessStatusCode)
                await HandleFailureAsync(response, contentText, request.Headers.Authorization is not null);
            if (typeof(T) == typeof(ApiEmpty)) return (T)(object)new ApiEmpty();
            return JsonSerializer.Deserialize<T>(contentText, JsonOptions)
                ?? throw new CampusGigApiException("The server returned an empty response.");
        }
        throw new CampusGigApiException("Unable to renew the session.");
    }

    public async Task LogoutAsync()
    {
        var refreshToken = session.RefreshToken;
        await session.ClearAccessSessionAsync();
        if (!string.IsNullOrWhiteSpace(refreshToken))
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/auth/logout")
                {
                    Content = JsonContent.Create(new { refreshToken }),
                };
                using var response = await http.SendAsync(request);
            }
            catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
            {
                System.Diagnostics.Debug.WriteLine($"Remote sign-out could not complete: {exception.Message}");
            }
        }
    }

    private async Task<bool> TryRefreshSessionAsync(string? failedAccessToken)
    {
        if (string.IsNullOrWhiteSpace(failedAccessToken) || string.IsNullOrWhiteSpace(session.RefreshToken))
            return false;
        await refreshGate.WaitAsync();
        try
        {
            if (!string.Equals(session.AccessToken, failedAccessToken, StringComparison.Ordinal)) return true;
            var refreshToken = session.RefreshToken;
            if (string.IsNullOrWhiteSpace(refreshToken)) return false;
            var sessionGeneration = session.Generation;
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/auth/refresh")
            {
                Content = JsonContent.Create(new { refreshToken }),
            };
            using var response = await http.SendAsync(request);
            if (!response.IsSuccessStatusCode) return false;
            var refreshed = await response.Content.ReadFromJsonAsync<AuthResponse>(JsonOptions);
            if (refreshed?.User is null || string.IsNullOrWhiteSpace(refreshed.AccessToken) ||
                string.IsNullOrWhiteSpace(refreshed.RefreshToken)) return false;
            return await session.SaveAsync(refreshed, sessionGeneration);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or JsonException)
        {
            System.Diagnostics.Debug.WriteLine($"Session renewal failed: {exception.Message}");
            return false;
        }
        finally
        {
            refreshGate.Release();
        }
    }

    private async Task HandleFailureAsync(HttpResponseMessage response, string content, bool requestHadBearerToken)
    {
        if (AuthorizationFailureRules.ShouldClearSession(response.StatusCode, requestHadBearerToken))
        {
            await session.ClearAccessSessionAsync();
            if (UnauthorizedReceived is not null && Interlocked.CompareExchange(ref unauthorizedSignalActive, 1, 0) == 0)
            {
                try
                {
                    await MainThread.InvokeOnMainThreadAsync(async () =>
                    {
                        try { await UnauthorizedReceived.Invoke(); } catch { }
                    });
                }
                finally
                {
                    Interlocked.Exchange(ref unauthorizedSignalActive, 0);
                }
            }
        }
        throw new CampusGigApiException(ReadError(content, response.ReasonPhrase), response.StatusCode);
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
                {
                    var msg = message.GetString();
                    if (!string.IsNullOrWhiteSpace(msg)) return msg;
                }
                if (message.ValueKind == JsonValueKind.Array)
                    return string.Join(Environment.NewLine, message.EnumerateArray().Select(x => x.GetString()));
            }

            if (document.RootElement.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Object)
            {
                var errorList = new List<string>();
                foreach (var prop in errors.EnumerateObject())
                {
                    if (prop.Value.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in prop.Value.EnumerateArray())
                        {
                            var s = item.GetString();
                            if (!string.IsNullOrWhiteSpace(s)) errorList.Add(s);
                        }
                    }
                    else if (prop.Value.ValueKind == JsonValueKind.String)
                    {
                        var s = prop.Value.GetString();
                        if (!string.IsNullOrWhiteSpace(s)) errorList.Add(s);
                    }
                }
                if (errorList.Count > 0) return string.Join(Environment.NewLine, errorList);
            }

            if (document.RootElement.TryGetProperty("error", out var err) && err.ValueKind == JsonValueKind.String)
            {
                var errStr = err.GetString();
                if (!string.IsNullOrWhiteSpace(errStr)) return errStr;
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
