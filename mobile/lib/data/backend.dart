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

/// How the app talks to the WAMA CRM server. The real one goes over HTTP; the demo one answers
/// from sample data, so every screen can be seen without an account.
abstract class Backend {
  Future<Map<String, dynamic>> get(String path, [Map<String, String>? query]);
  Future<Map<String, dynamic>> send(String method, String path, Map<String, dynamic> body);

  /// Send a file (a photo or document for a chat). Returns the server's reply ({ url, filename }).
  Future<Map<String, dynamic>> upload(String path, List<int> bytes, String filename, {Map<String, String> fields = const {}});
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

  Map<String, String> _headers() {
    final token = client.auth.currentSession?.accessToken;
    return {'Content-Type': 'application/json', if (token != null) 'Authorization': 'Bearer $token'};
  }

  Future<Map<String, dynamic>> _read(Future<http.Response> request) async {
    final http.Response res;
    try {
      res = await request.timeout(_timeout);
    } on TimeoutException {
      throw OfflineException('The server took too long to answer.');
    } catch (_) {
      throw OfflineException();
    }
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
  Future<Map<String, dynamic>> get(String path, [Map<String, String>? query]) => _read(http.get(Uri.parse('${AppConfig.apiBase}$path').replace(queryParameters: query), headers: _headers()));

  @override
  Future<Map<String, dynamic>> send(String method, String path, Map<String, dynamic> body) {
    final uri = Uri.parse('${AppConfig.apiBase}$path');
    final payload = jsonEncode(body);
    return _read(switch (method) {
      'PUT' => http.put(uri, headers: _headers(), body: payload),
      'PATCH' => http.patch(uri, headers: _headers(), body: payload),
      'DELETE' => http.delete(uri, headers: _headers(), body: payload),
      _ => http.post(uri, headers: _headers(), body: payload),
    });
  }

  @override
  Future<Map<String, dynamic>> upload(String path, List<int> bytes, String filename, {Map<String, String> fields = const {}}) {
    final request = http.MultipartRequest('POST', Uri.parse('${AppConfig.apiBase}$path'))
      ..headers.addAll({..._headers()}..remove('Content-Type'))
      ..fields.addAll(fields)
      ..files.add(http.MultipartFile.fromBytes('file', bytes, filename: filename));
    return _read(request.send().then(http.Response.fromStream));
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
    await client.auth.signOut();
  }

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
