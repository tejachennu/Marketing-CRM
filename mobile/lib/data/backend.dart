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
  Future<Map<String, dynamic>> upload(String path, List<int> bytes, String filename);
  Future<void> signIn(String email, String password);
  Future<void> signOut();
  bool get signedIn;
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
  Future<Map<String, dynamic>> upload(String path, List<int> bytes, String filename) {
    final request = http.MultipartRequest('POST', Uri.parse('${AppConfig.apiBase}$path'))
      ..headers.addAll({..._headers()}..remove('Content-Type'))
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

  @override
  Future<void> signOut() => client.auth.signOut();

  @override
  bool get signedIn => client.auth.currentSession != null;
}
