import 'dart:convert';
import 'dart:io';

/// What the server has configured, from `GET /api/config`.
///
/// Read, never written. Credentials belong in the server's `.env` — copying secrets
/// across apps on a phone is miserable, and the keyboard mangles them: autocapitalization
/// and autocorrect leave damage that is invisible afterwards. One copy in `.env` covers
/// every client.
class ServerConfig {
  const ServerConfig({
    required this.appId,
    required this.avatarId,
    required this.region,
    required this.sampleRate,
    required this.realtimeUrl,
    required this.missingSample,
    required this.missingRealtime,
  });

  final String appId;
  final String avatarId;
  final String region;
  final int sampleRate;

  /// Where the realtime scene's WebSocket lives.
  final String realtimeUrl;

  /// Which credentials each scene is still waiting on, as named in the server's
  /// `.env`. The sample-audio scene needs only the Spatius pair, so it can run while
  /// the realtime one is still unconfigured — worth telling the user rather than
  /// failing at the tap.
  final List<String> missingSample;
  final List<String> missingRealtime;
}

/// Talks to the Direct Mode server.
///
/// Direct Mode means this client holds the Motion Server connection itself, but the
/// API key that mints a session token never reaches the device: the server signs one
/// and hands it over, which is what `fetchSessionToken` asks for.
class BackendClient {
  static const _timeout = Duration(seconds: 10);

  static String _trimmed(String url) =>
      url.trim().replaceAll(RegExp(r'/+$'), '');

  /// What the server has configured. Costs nothing and starts nothing.
  static Future<ServerConfig> fetchConfig(String baseUrl) async {
    final json = await _get(baseUrl, '/api/config');

    // `missing` is an object keyed by scene, not a flat list.
    final missing = json['missing'] as Map<String, dynamic>?;
    List<String> listFor(String key) =>
        (missing?[key] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [];

    return ServerConfig(
      // SPATIUS_APP_ID, not appId: the server returns its .env keys verbatim
      // alongside the derived fields, and this one has no derived alias.
      appId: json['SPATIUS_APP_ID'] as String? ?? '',
      avatarId: json['avatarId'] as String? ?? '',
      region: json['region'] as String? ?? 'us-west',
      sampleRate: (json['sampleRate'] as num?)?.toInt() ?? 16000,
      realtimeUrl: json['realtimeUrl'] as String? ?? '',
      missingSample: listFor('sample'),
      missingRealtime: listFor('realtime'),
    );
  }

  /// A session token, minted by the server from an API key this device never sees.
  static Future<String> fetchSessionToken(String baseUrl) async {
    final json = await _post(baseUrl, '/api/session-token');
    // sessionToken, not token: the server names it after what it is, and reading the
    // wrong key gets an empty string that only fails at SDK initialization.
    final token = json['sessionToken'] as String? ?? '';
    if (token.isEmpty) throw Exception('The server returned no session token');
    return token;
  }

  static Future<Map<String, dynamic>> _get(String baseUrl, String path) async {
    final client = HttpClient()..connectionTimeout = _timeout;
    try {
      final request = await client.getUrl(Uri.parse('${_trimmed(baseUrl)}$path'));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(_serverMessage(body, response.statusCode));
      }
      return jsonDecode(body) as Map<String, dynamic>;
    } finally {
      client.close();
    }
  }

  static Future<Map<String, dynamic>> _post(String baseUrl, String path) async {
    final client = HttpClient()..connectionTimeout = _timeout;
    try {
      final request = await client.postUrl(Uri.parse('${_trimmed(baseUrl)}$path'));
      request.headers.contentType = ContentType.json;
      request.write('{}');
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(_serverMessage(body, response.statusCode));
      }
      return jsonDecode(body) as Map<String, dynamic>;
    } finally {
      client.close();
    }
  }

  /// The server's own wording for a failure, so a missing credential names itself
  /// rather than arriving as "HTTP 500".
  static String _serverMessage(String body, int code) {
    try {
      final json = jsonDecode(body) as Map<String, dynamic>;
      final missing = (json['missingKeys'] as List<dynamic>?)
          ?.map((e) => e.toString())
          .toList();
      if (missing != null && missing.isNotEmpty) {
        return 'The server is missing: ${missing.join(', ')}';
      }
      final error = json['error'] as String?;
      if (error != null && error.isNotEmpty) return error;
    } catch (_) {
      // Not JSON — fall through to the status code.
    }
    return 'Server returned HTTP $code.';
  }
}
