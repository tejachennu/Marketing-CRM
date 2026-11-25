import 'dart:typed_data';
import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config.dart';

/// The server said no (a 4xx or 5xx), with its message in plain words.
class ApiException implements Exception {
  ApiException(this.status, this.message);
  final int status;
  final String message;

  /// Worth trying again later (server busy or broken), as opposed to a request it refused.
  bool get retryable => status >= 500 || status == 409 || status == 429;
  @override
  String toString() => message;
}

/// No connection: the request never reached the server, or the reply never came back.
class OfflineException implements Exception {
  OfflineException([this.message = 'No internet connection.']);
  final String message;
  @override
  String toString() => message;
}

/// The server got the request but did not answer in time: it may still be doing it (so do not simply send it again).
class SlowServerException extends OfflineException {
  SlowServerException([super.message = 'It is taking longer than usual. Check in a minute before trying again.']);
}

/// How the app talks to the WAMA CRM server. The real one goes over HTTP; the demo one answers
/// from sample data, so every screen can be seen without an account.
abstract class Backend {
  Future<Map<String, dynamic>> get(String path, [Map<String, String>? query]);

  /// [timeout]: how long to wait for the answer (by default, longer for the routes that take longer, see HttpBackend).
  Future<Map<String, dynamic>> send(String method, String path, Map<String, dynamic> body, {Duration? timeout});

  /// Send a file (a photo or document for a chat). Returns the server's reply ({ url, filename }).
  Future<Map<String, dynamic>> upload(String path, List<int> bytes, String filename, {Map<String, String> fields = const {}, Duration? timeout});

  /// Put a big file straight into storage with a one-time upload pass the server handed out
  /// (/api/knowledge/upload-url), so it does not go through the server's size limit.
  Future<void> uploadToStorage(String bucket, String path, String token, List<int> bytes, String contentType);
  Future<void> signIn(String email, String password);

  /// "Continue with Google": opens Google in the browser and waits until it comes back signed in.
  Future<void> signInWithGoogle();
  Future<void> signOut();
  bool get signedIn;

  /// Live changes for the workspace (new messages, read ticks, chats). Calls back with the table,
  /// the change ("INSERT" / "UPDATE") and the row. Stop with [stopLive].
  void live(String organizationId, void Function(String table, String change, Map<String, dynamic> row) onChange);
  void stopLive();
}

class HttpBackend implements Backend {
  HttpBackend(this.client);
  final SupabaseClient client;
  static const _timeout = Duration(seconds: 25);

  /// Routes that take longer than most (publishing an Instagram post, switching a connector on, AI writing,
  /// a counter action that sends the bill on WhatsApp). Checked in order, so the longer, exact ones come first.
  static const _slowRoutes = {
    '/api/instagram/posts': 90,
    '/api/instagram/': 65,
    '/api/connectors': 65,
    '/api/billing': 65,
    '/api/salon/tick': 65,
    '/api/commerce/products/import': 65,
    '/api/commerce/shipping/ship': 65,
    '/api/ai/': 40,
    '/api/whatsapp-templates/ai-draft': 40,
    '/api/salon/booking-flow/': 40,
    '/api/knowledge/gaps': 40,
    '/api/commerce/products/describe': 40,
    '/api/salon/act': 40,
    '/api/salon/templates': 40,
    '/api/messages/send': 40,
  };

  /// How long to wait for this route's answer.
  static Duration timeoutFor(String path) {
    for (final route in _slowRoutes.entries) {
      if (path.startsWith(route.key)) return Duration(seconds: route.value);
    }
    return _timeout;
  }

  /// A file has to go up over the phone's connection first: allow more time for a bigger one (a few MB on slow mobile data).
  static Duration uploadTimeout(int bytes) => Duration(seconds: (45 + bytes ~/ 40000).clamp(45, 300));

  /// The sign-in, renewed first when it has run out (the phone was away for more than an hour).
  Future<Map<String, String>> _headers() async {
    String? token;
    try {
      token = (await client.auth.getSession())?.accessToken;
    } on AuthRetryableFetchException {
      throw OfflineException();
    } on AuthException {
      token = null; // could not be renewed: the server answers "sign in again"
    } catch (_) {
      throw OfflineException();
    }
    return {'Content-Type': 'application/json', if (token != null) 'Authorization': 'Bearer $token'};
  }

  /// Renew the sign-in once after the server said it has run out. False when it cannot be renewed.
  Future<bool> _renewSession() async {
    if (client.auth.currentSession == null) return false;
    try {
      await client.auth.refreshSession();
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, dynamic>> _read(Future<http.Response> Function(Map<String, String> headers) request, Duration timeout, {bool renewed = false}) async {
    final headers = await _headers();
    final http.Response res;
    try {
      res = await request(headers).timeout(timeout);
    } on TimeoutException {
      throw SlowServerException();
    } catch (_) {
      throw OfflineException();
    }
    // The sign-in ran out between the check and the answer: renew it and ask once more
    if (res.statusCode == 401 && !renewed && await _renewSession()) return _read(request, timeout, renewed: true);
    Map<String, dynamic> data = {};
    try {
      final decoded = jsonDecode(res.body);
      if (decoded is Map<String, dynamic>) data = decoded;
    } catch (_) {}
    if (res.statusCode >= 400) {
      final error = data['error'];
      final message = error is Map ? (error['message'] ?? 'Something went wrong.') : (error ?? 'Something went wrong (${res.statusCode}). Please try again.');
      throw ApiException(res.statusCode, message.toString());
    }
    return data;
  }

  @override
  Future<Map<String, dynamic>> get(String path, [Map<String, String>? query]) =>
      _read((headers) => http.get(Uri.parse('${AppConfig.apiBase}$path').replace(queryParameters: query), headers: headers), timeoutFor(path));

  @override
  Future<Map<String, dynamic>> send(String method, String path, Map<String, dynamic> body, {Duration? timeout}) {
    final uri = Uri.parse('${AppConfig.apiBase}$path');
    final payload = jsonEncode(body);
    return _read(
      (headers) => switch (method) {
        'PUT' => http.put(uri, headers: headers, body: payload),
        'PATCH' => http.patch(uri, headers: headers, body: payload),
        'DELETE' => http.delete(uri, headers: headers, body: payload),
        _ => http.post(uri, headers: headers, body: payload),
      },
      timeout ?? timeoutFor(path),
    );
  }

  @override
  Future<Map<String, dynamic>> upload(String path, List<int> bytes, String filename, {Map<String, String> fields = const {}, Duration? timeout}) {
    Future<http.Response> request(Map<String, String> headers) {
      final request = http.MultipartRequest('POST', Uri.parse('${AppConfig.apiBase}$path'))
        ..headers.addAll({...headers}..remove('Content-Type'))
        ..fields.addAll(fields)
        ..files.add(http.MultipartFile.fromBytes('file', bytes, filename: filename));
      return request.send().then(http.Response.fromStream);
    }

    return _read(request, timeout ?? uploadTimeout(bytes.length));
  }

  @override
  Future<void> uploadToStorage(String bucket, String path, String token, List<int> bytes, String contentType) async {
    try {
      await client.storage.from(bucket).uploadBinaryToSignedUrl(path, token, Uint8List.fromList(bytes), FileOptions(contentType: contentType));
    } catch (e) {
      throw ApiException(400, 'The file could not be uploaded. Check the internet and try again.');
    }
  }

  @override
  Future<void> signIn(String email, String password) async {
    try {
      await client.auth.signInWithPassword(email: email, password: password);
    } on AuthException catch (e) {
      throw ApiException(401, e.message);
    } catch (_) {
      throw OfflineException('Signing in needs the internet once. After that the app works offline.');
    }
  }

  /// Where Google sends the person back: this app (see the intent filter in AndroidManifest.xml).
  /// It must be in Supabase → Authentication → URL configuration → Redirect URLs.
  static const oauthReturn = 'com.magnetora.wamacrm://login-callback';

  @override
  Future<void> signInWithGoogle() async {
    final done = Completer<void>();
    final sub = client.auth.onAuthStateChange.listen(
      (event) {
        if (event.event == AuthChangeEvent.signedIn && event.session != null && !done.isCompleted) done.complete();
      },
      onError: (Object e) {
        if (!done.isCompleted) done.completeError(ApiException(401, e is AuthException ? e.message : 'Signing in with Google did not finish. Please try again.'));
      },
    );
    try {
      final opened = await client.auth.signInWithOAuth(
        OAuthProvider.google,
        redirectTo: oauthReturn,
        authScreenLaunchMode: LaunchMode.externalApplication,
        queryParams: const {'prompt': 'select_account'},
      );
      if (!opened) throw ApiException(400, 'Google could not be opened on this phone.');
      // The person picks their account in the browser; give up after a few minutes (they can tap again)
      await done.future.timeout(const Duration(minutes: 4), onTimeout: () => throw ApiException(408, 'Signing in with Google did not finish. Please try again.'));
    } on AuthException catch (e) {
      throw ApiException(
        401,
        RegExp('provider is not enabled|Unsupported provider', caseSensitive: false).hasMatch(e.message) ? 'Signing in with Google is not switched on yet. Please use your email for now.' : e.message,
      );
    } on ApiException {
      rethrow;
    } catch (_) {
      throw OfflineException('Signing in needs the internet.');
    } finally {
      await sub.cancel();
    }
  }

  @override
  Future<void> signOut() async {
    stopLive();
    try {
      await client.auth.signOut();
    } catch (_) {
      // No internet: the sign-in is already gone from this phone; the server forgets it when it runs out
    }
  }

  /// The sign-in ended without the app asking (it could not be renewed: password changed on the web, removed from the team).
  StreamSubscription<AuthState> whenSignedOut(void Function() then) => client.auth.onAuthStateChange.listen((state) {
    if (state.event == AuthChangeEvent.signedOut) then();
  }, onError: (Object _) {});

  RealtimeChannel? _channel;

  @override
  void live(String organizationId, void Function(String table, String change, Map<String, dynamic> row) onChange) {
    stopLive();
    final filter = PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'organization_id', value: organizationId);
    var channel = client.channel('wama-app-$organizationId');
    for (final table in ['messages', 'conversations']) {
      channel = channel.onPostgresChanges(
        event: PostgresChangeEvent.all,
        schema: 'public',
        table: table,
        filter: filter,
        callback: (payload) => onChange(table, payload.eventType.name.toUpperCase(), Map<String, dynamic>.from(payload.newRecord)),
      );
    }
    _channel = channel..subscribe();
  }

  @override
  void stopLive() {
    final channel = _channel;
    _channel = null;
    if (channel != null) client.removeChannel(channel);
  }

  @override
  bool get signedIn => client.auth.currentSession != null;
}
