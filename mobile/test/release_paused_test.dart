import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/data/backend.dart';
import 'package:wama_mobile/data/demo_backend.dart';
import 'package:wama_mobile/data/format.dart';
import 'package:wama_mobile/data/local_store.dart';

/// The trial ends while the app is open: the server refuses (402), the app shows the plan screen, and a change made
/// meanwhile waits on the phone and is sent once a plan is chosen.
void main() {
  test('402 → plan screen; a waiting change is kept and sent after paying', () async {
    final dir = await Directory.systemTemp.createTemp('wama_paused');
    final store = LocalStore();
    await store.open(path: dir.path);
    await store.clear();
    final backend = DemoBackend();
    final app = AppState(backend: backend, store: store);
    await app.refreshAll();
    expect(app.paused, isFalse);

    backend.billing = 'ended';
    await expectLater(app.ask('/api/contacts', {'name': 'Ravi'}), throwsA(isA<ApiException>().having((e) => e.status, 'status', 402)));
    for (var i = 0; i < 40 && !app.paused; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    expect(app.paused, isTrue, reason: 'the profile is read again and says the trial ended');
    expect(app.trialEnded, isTrue);

    final appointment = (app.cached(AppState.dayKey(istToday()))?['appointments'] as List? ?? const []).cast<Map>().firstOrNull;
    final item = await app.counterAction(kind: 'status', label: 'Mark arrived', action: {'type': 'set_status', 'appointment_id': appointment?['id'] ?? 'a1', 'status': 'arrived'});
    await app.flush();
    expect(app.outbox.firstWhere((o) => o.id == item.id).state, OutboxState.waiting, reason: 'kept while paused');

    backend.billing = 'paid';
    await app.load('me', '/api/mobile/me', force: true);
    expect(app.paused, isFalse);
    await app.flush();
    expect(app.outbox.where((o) => o.id == item.id), isEmpty, reason: 'sent once the plan is on');
  });
}
