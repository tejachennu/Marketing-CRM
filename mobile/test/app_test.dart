import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/data/demo_backend.dart';
import 'package:wama_mobile/data/format.dart';
import 'package:wama_mobile/data/local_store.dart';
import 'package:wama_mobile/screens/front_desk/logic.dart';
import 'package:wama_mobile/screens/templates/template_widgets.dart';
import 'package:wama_mobile/ui/widgets.dart';

Future<(AppState, DemoBackend)> makeApp() async {
  final dir = await Directory.systemTemp.createTemp('wama_test');
  final store = LocalStore();
  await store.open(path: dir.path);
  await store.clear();
  final backend = DemoBackend();
  final app = AppState(backend: backend, store: store);
  await app.refreshAll();
  return (app, backend);
}

void main() {
  test('Phone numbers: country code split and joined', () {
    final (india, local) = splitPhone('+919876543210');
    expect(india.code, '+91');
    expect(local, '9876543210');
    final (uae, rest) = splitPhone('+971501234567');
    expect(uae.code, '+971');
    expect(rest, '501234567');
    final (fallback, typed) = splitPhone('98765 43210');
    expect(fallback.code, '+91');
    expect(joinPhone(fallback, typed), '+919876543210');
    expect(joinPhone(uae, '050 123 4567'), '+971501234567');
    expect(joinPhone(uae, ''), '');
  });

  test('Rupees use Indian grouping', () {
    expect(formatRupees(150000), '₹1,50,000');
    expect(formatRupees(99.5), '₹99.50');
    expect(shortRupees(250000), '₹2.5L');
  });

  test('Templates: blanks found and filled', () {
    final parts = TemplateParts({
      'components': [
        {'type': 'HEADER', 'format': 'TEXT', 'text': 'Hello'},
        {'type': 'BODY', 'text': 'Hi {{1}}, your bill {{2}} is ready. Thanks {{1}}!'},
      ],
    });
    expect(parts.header, 'Hello');
    expect(parts.blanks, ['1', '2']);
    expect(parts.fill({'1': 'Priya', '2': 'GLOW-7'}), 'Hi Priya, your bill GLOW-7 is ready. Thanks Priya!');
    expect(parts.fill({'1': 'Priya'}), 'Hi Priya, your bill {{2}} is ready. Thanks Priya!');
  });

  test('Offline: a bill waits on the phone, shows in the list, and syncs once online', () async {
    final (app, backend) = await makeApp();
    final before = FrontDesk(app).invoices.length;
    backend.offline = true;
    await app.counterAction(
      kind: 'bill',
      label: 'Bill for Ravi',
      localId: AppState.newLocalId(),
      resultIdPath: 'invoice.id',
      action: {'type': 'walk_in_bill', 'customer': {'name': 'Ravi'}, 'service_ids': ['s-menscut'], 'payment_method': 'cash'},
      preview: {'customer_name': 'Ravi', 'total': 300, 'status': 'paid', 'payment_method': 'cash', 'issued_at': DateTime.now().toUtc().toIso8601String()},
    );
    await app.flush();
    expect(app.online, isFalse);
    expect(app.waitingCount, 1);
    expect(FrontDesk(app).invoices.first['customer_name'], 'Ravi');
    expect(FrontDesk(app).invoices.first['_outbox'], isNotNull);

    backend.offline = false;
    await app.flush();
    await app.refreshAll();
    expect(app.waitingCount, 0);
    final invoices = FrontDesk(app).invoices;
    expect(invoices.length, before + 1);
    expect(invoices.first['number'], startsWith('GLOW-'));
    expect(invoices.first['_outbox'], isNull);
  });

  test('Offline: a booking and a change to it sync in order, using the server id', () async {
    final (app, backend) = await makeApp();
    backend.offline = true;
    final localId = AppState.newLocalId();
    final start = fromIst(istNow().add(const Duration(days: 1)), 15, 0);
    await app.counterAction(kind: 'booking', label: 'Book Asha', localId: localId, resultIdPath: 'appointment.id', action: {'type': 'create_appointment', 'customer': {'name': 'Asha'}, 'service_ids': ['s-facial'], 'starts_at': start.toIso8601String()});
    await app.counterAction(kind: 'appointment', label: 'Asha arrived', action: {'type': 'set_status', 'appointment_id': localId, 'status': 'arrived'});
    await app.flush();
    expect(app.waitingCount, 2);

    backend.offline = false;
    await app.flush();
    expect(app.waitingCount, 0);
    expect(app.store.serverId(localId), isNotNull);
  });

  test('A change the server refuses stops with its reason, and can be discarded', () async {
    final (app, _) = await makeApp();
    await app.counterAction(kind: 'payment', label: 'Pay', action: {'type': 'not_a_thing'});
    await app.flush();
    expect(app.failedCount, 1);
    expect(app.outbox.first.error, 'Unknown action.');
    await app.discard(app.outbox.first);
    expect(app.waitingCount, 0);
  });

  test('Front Desk categories follow the business order', () async {
    final (app, _) = await makeApp();
    expect(FrontDesk(app).categories, ['Hair', 'Skin', 'Nails']);
  });
}
