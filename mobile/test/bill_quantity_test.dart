import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/data/demo_backend.dart';
import 'package:wama_mobile/data/local_store.dart';
import 'package:wama_mobile/main.dart';
import 'package:wama_mobile/screens/front_desk/logic.dart';
import 'package:wama_mobile/screens/front_desk/pickers.dart';

import 'screen_check.dart';

/// A count for each service on a new bill (owner, 28 Nov 2026: "count vundali ga prati product ki"): 3 × Haircut is
/// one line with quantity 3, the totals and the membership card follow it, the server gets the counts; and the
/// Save bill button sits against the right edge ("alignment sariga ledu").
void main() {
  test('Bill counts: a line is price × how many; a card frees as many as it has sessions left', () {
    expect(lineCount({'price': 60}), 1);
    expect(lineCount({'price': 60, 'quantity': 3}), 3);
    expect(lineCount({'price': 60, 'quantity': 0}), 1);
    expect(lineCount({'price': 60, 'quantity': 500}), maxQuantity);
    expect(lineAmount({'price': 60, 'quantity': 3}), 180);

    final card = {
      'plan': {'discount_percent': 10},
      'sessions': [
        {'service_id': 's1', 'total': 4, 'used': 3},
      ],
    };
    final use = applyMemberCard(card, [
      {'service_id': 's1', 'name': 'Haircut', 'price': 500, 'quantity': 3},
    ]);
    expect(use.lines.map((l) => [l['name'], l['quantity'], l['price']]).toList(), [
      ['Haircut (membership)', 1, 0],
      ['Haircut', 2, 450],
    ]);
    expect(use.free, 1);
    expect(use.discount, 100);
  });

  testWidgets('New bill: − / + count on a picked service, the bill follows it, the server gets it', (tester) async {
    await loadFonts();
    late AppState app;
    late DemoBackend backend;
    await tester.runAsync(() async {
      final dir = await Directory.systemTemp.createTemp('wama_qty');
      final store = LocalStore();
      await store.open(path: dir.path);
      await store.clear();
      backend = DemoBackend();
      app = AppState(backend: backend, store: store);
      await app.refreshAll();
    });
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(WamaApp(app: app, screen: 'new_bill'));
    Future<void> settle() async {
      for (var i = 0; i < 8; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    await settle();
    // The button fills the right half and ends at the bar's right padding, not in the middle
    final button = find.widgetWithText(FilledButton, 'Save bill');
    expect(tester.getRect(button).right, closeTo(390 - 16, 1));
    expect(tester.getRect(find.byType(ListView).first).height, greaterThan(500), reason: 'the bar stays as tall as its button');

    final page = find.descendant(of: find.byType(ListView).first, matching: find.byType(Scrollable)).first;
    await tester.scrollUntilVisible(find.text('Haircut (Men)'), 200, scrollable: page);
    await tester.tap(find.text('Haircut (Men)').first);
    await settle();
    expect(find.text('How many?'), findsOneWidget);
    final plus = find.descendant(of: find.byType(QtyStepper), matching: find.byIcon(Icons.add));
    await tester.ensureVisible(plus);
    await tester.tap(plus);
    await tester.pump();
    await tester.tap(plus);
    await settle();
    expect(find.text('₹300 each'), findsOneWidget);
    expect(find.text('3 services · total'), findsOneWidget);
    expect(find.text('₹900'), findsWidgets, reason: 'the row and the bar');
    // Who did it and the bill summary further down say the count
    await tester.scrollUntilVisible(find.text('Bill summary'), 300, scrollable: page);
    await settle();
    expect(find.text('3 × Haircut (Men)'), findsWidgets);

    // One less, then save
    await tester.scrollUntilVisible(find.text('₹300 each'), -300, scrollable: page);
    final minus = find.descendant(of: find.byType(QtyStepper), matching: find.byIcon(Icons.remove));
    await tester.ensureVisible(minus);
    await settle();
    await tester.tap(minus);
    await settle();
    expect(find.text('2 services · total'), findsOneWidget);
    await tester.tap(button);
    await settle();
    final bills = await tester.runAsync(() => backend.get('/api/salon/invoices', {}));
    final first = ((bills!['invoices'] as List).first as Map)['items'] as List;
    expect(first.map((i) => [(i as Map)['name'], i['quantity']]).toList(), [
      ['Haircut (Men)', 2],
    ]);
  });
}
