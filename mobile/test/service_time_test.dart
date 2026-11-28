import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/data/demo_backend.dart';
import 'package:wama_mobile/data/local_store.dart';
import 'package:wama_mobile/main.dart';
import 'package:wama_mobile/screens/front_desk/logic.dart';

import 'screen_check.dart';

/// "Takes time" on a service (owner, 28 Nov 2026: "Prati service ki time vundadu just billing vuntadi time enable
/// disable option evu"): a billing-only service shows no minutes on a bill and is not offered for a booking.
void main() {
  late AppState app;
  late DemoBackend backend;
  setUpAll(() async {
    await loadFonts();
    final dir = await Directory.systemTemp.createTemp('wama_time');
    final store = LocalStore();
    await store.open(path: dir.path);
    await store.clear();
    backend = DemoBackend();
    app = AppState(backend: backend, store: store);
    await app.refreshAll();
    // Threading becomes billing only (Setup → Services → Takes time off)
    await app.ask('/api/salon/services', {'id': 's-threading', 'takes_time': false}, method: 'PATCH');
    await app.refreshAll();
  });

  test('Service time: missing counts as on; billing-only services are left out of bookings, kept on bills', () {
    expect(takesTime({}), isTrue);
    expect(takesTime({'takes_time': false}), isFalse);
    final desk = FrontDesk(app);
    expect(desk.billServices.map((s) => s['name']), contains('Threading'));
    expect(desk.bookServices.map((s) => s['name']), isNot(contains('Threading')));
    expect(desk.bookServices.map((s) => s['name']), contains('Gold facial'));
  });

  Future<void> open(WidgetTester tester, String screen) async {
    tester.view.physicalSize = const Size(390, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(WamaApp(app: app, screen: screen));
    for (var i = 0; i < 8; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  testWidgets('New bill: a billing-only service has no minutes', (tester) async {
    await open(tester, 'new_bill');
    expect(find.text('Threading'), findsOneWidget);
    expect(find.text('15 min · Skin'), findsNothing);
    expect(find.text('Skin'), findsWidgets, reason: 'only its category');
    expect(find.text('60 min · Skin'), findsOneWidget, reason: 'services that take time keep their minutes');
  });

  testWidgets('New booking: a billing-only service is not offered', (tester) async {
    await open(tester, 'new_booking');
    expect(find.text('Gold facial'), findsOneWidget);
    expect(find.text('Threading'), findsNothing);
  });
}
