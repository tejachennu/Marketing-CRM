import 'dart:convert';

import 'package:hive_ce_flutter/hive_ce_flutter.dart';

/// Everything the app keeps on the phone, so it opens and works without internet:
/// - cache: the last copy of each list from the server (JSON by key), with when it was fetched
/// - outbox: changes made on the phone, waiting to be sent, in order
/// - ids: local ids (made offline) mapped to the server's ids once synced
class LocalStore {
  late Box<String> _cache;
  late Box<String> _outbox;
  late Box<String> _ids;

  /// [path]: a folder to keep the data in (tests); the app uses its own storage.
  Future<void> open({String? path}) async {
    if (path != null) {
      Hive.init(path);
    } else {
      await Hive.initFlutter('wama');
    }
    _cache = await Hive.openBox<String>('cache');
    _outbox = await Hive.openBox<String>('outbox');
    _ids = await Hive.openBox<String>('ids');
  }

  // ── Cache ──

  /// When each list was saved, kept in memory too, so checking it does not read the whole list again.
  final _savedAt = <String, DateTime?>{};

  Map<String, dynamic>? read(String key) {
    final raw = _cache.get(key);
    if (raw == null) return null;
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  Future<void> write(String key, Map<String, dynamic> value) {
    final now = DateTime.now();
    _savedAt[key] = now;
    return _cache.put(key, jsonEncode({...value, '_savedAt': now.toIso8601String()}));
  }

  DateTime? savedAt(String key) => _savedAt.putIfAbsent(key, () => DateTime.tryParse(read(key)?['_savedAt']?.toString() ?? ''));

  Future<void> remove(String key) {
    _savedAt.remove(key);
    return _cache.delete(key);
  }

  /// Remove every saved list whose key matches (old chats' messages, so the phone does not fill up).
  Future<void> removeWhere(bool Function(String key) test) async {
    final keys = [for (final key in _cache.keys) if (key is String && test(key)) key];
    for (final key in keys) {
      _savedAt.remove(key);
    }
    if (keys.isNotEmpty) await _cache.deleteAll(keys);
  }

  // ── Outbox ──
  List<OutboxItem> outbox() {
    final items = _outbox.values.map((raw) => OutboxItem.fromJson(jsonDecode(raw) as Map<String, dynamic>)).toList();
    items.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    return items;
  }

  Future<void> putOutbox(OutboxItem item) => _outbox.put(item.id, jsonEncode(item.toJson()));
  Future<void> removeOutbox(String id) => _outbox.delete(id);

  // ── Local ids → server ids ──
  String? serverId(String localId) => _ids.get(localId);
  Future<void> mapId(String localId, String serverId) => _ids.put(localId, serverId);

  /// Kept when signing out: where to sign in (so the next sign-in works offline-first), and a notification address
  /// still to be dropped (see Push.dropOldAddress).
  static const _keep = ['config', 'push_drop'];

  /// Signing out: everything goes except [_keep]. [keepOutbox]: the server ended the sign-in, so changes still waiting
  /// stay (with who made them, in 'outbox_owner') for that person's next sign-in.
  Future<void> clear({bool keepOutbox = false}) async {
    final kept = {
      for (final key in [..._keep, if (keepOutbox) 'outbox_owner']) key: _cache.get(key),
    };
    await _cache.clear();
    _savedAt.clear();
    for (final entry in kept.entries) {
      if (entry.value != null) await _cache.put(entry.key, entry.value!);
    }
    if (!keepOutbox) await clearOutbox();
  }

  /// Drop every change waiting to be sent (someone else signed in on this phone).
  Future<void> clearOutbox() async {
    await _outbox.clear();
    await _ids.clear();
  }
}

enum OutboxState { waiting, sending, failed }

/// One change made on the phone, waiting to reach the server.
class OutboxItem {
  OutboxItem({
    required this.id,
    required this.kind,
    required this.label,
    required this.method,
    required this.path,
    required this.body,
    required this.createdAt,
    this.state = OutboxState.waiting,
    this.error,
    this.attempts = 0,
    this.localId,
    this.resultIdPath,
  });

  /// Also the client reference the server uses to do it only once.
  final String id;

  /// bill, booking, appointment, payment, contact, message, campaign, campaign_run
  final String kind;

  /// What it is, in words: "Bill for Priya · ₹700"
  final String label;
  final String method;
  final String path;
  final Map<String, dynamic> body;
  final DateTime createdAt;
  OutboxState state;
  String? error;
  int attempts;

  /// The local id given to what this creates (shown in lists until synced).
  final String? localId;

  /// Where the server's id for it is in the reply, like "invoice.id".
  final String? resultIdPath;

  Map<String, dynamic> toJson() => {
    'id': id,
    'kind': kind,
    'label': label,
    'method': method,
    'path': path,
    'body': body,
    'createdAt': createdAt.toIso8601String(),
    'state': state.name,
    'error': error,
    'attempts': attempts,
    'localId': localId,
    'resultIdPath': resultIdPath,
  };

  factory OutboxItem.fromJson(Map<String, dynamic> json) => OutboxItem(
    id: json['id'],
    kind: json['kind'],
    label: json['label'] ?? '',
    method: json['method'] ?? 'POST',
    path: json['path'],
    body: Map<String, dynamic>.from(json['body'] ?? {}),
    createdAt: DateTime.tryParse(json['createdAt'] ?? '') ?? DateTime.now(),
    state: OutboxState.values.firstWhere((s) => s.name == json['state'], orElse: () => OutboxState.waiting),
    error: json['error'],
    attempts: json['attempts'] ?? 0,
    localId: json['localId'],
    resultIdPath: json['resultIdPath'],
  );
}
