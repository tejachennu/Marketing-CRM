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
  Map<String, dynamic>? read(String key) {
    final raw = _cache.get(key);
    if (raw == null) return null;
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  Future<void> write(String key, Map<String, dynamic> value) => _cache.put(key, jsonEncode({...value, '_savedAt': DateTime.now().toIso8601String()}));

  DateTime? savedAt(String key) => DateTime.tryParse(read(key)?['_savedAt']?.toString() ?? '');

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

  Future<void> clear() async {
    await _cache.clear();
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
