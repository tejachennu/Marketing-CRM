import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/data/demo_backend.dart';
import 'package:wama_mobile/data/local_store.dart';
import 'package:wama_mobile/main.dart';
import 'package:wama_mobile/screens/templates/auto_messages_screen.dart';

import 'release_helpers.dart' show reach, settle, tapText;

/// The templates for Front Desk's and the shop's automatic messages (owner, 25 Nov 2026: "message templates upgrade
/// for Frontdesk and the ecommerce — if they want they can edit it and apply for approval").
void main() {
  late AppState app;
  late DemoBackend backend;
  setUpAll(() async {
    final dir = await Directory.systemTemp.createTemp('wama_auto_templates');
    final store = LocalStore();
    await store.open(path: dir.path);
    await store.clear();
    backend = DemoBackend();
    app = AppState(backend: backend, store: store);
    await app.refreshAll();
  });

  List<Map> views(Map data) => [for (final v in data['autoMessages'] as List) v as Map];
  Map viewOf(Map data, String purpose) => views(data).firstWhere((v) => v['purpose'] == purpose);

  test('blanks are words in braces: any letter case, keys too, and unknown ones are named', () {
    final fields = [
      {'key': 'first_name', 'label': 'Customer first name', 'sample': 'Priya'},
      {'key': 'amount', 'label': 'Bill amount', 'sample': '₹1,200'},
    ];
    expect(fieldFor('customer  FIRST name', fields)?['key'], 'first_name');
    expect(fieldFor('amount', fields)?['key'], 'amount');
    expect(fieldFor('Pet name', fields), isNull);
    expect(unknownBlanks('Hi {Customer first name}, {Pet name} and {Pet name}, {{1}}', fields), ['Pet name']);
  });

  test('Front Desk: each message with its wording and where it stands; sending makes a new version', () async {
    var data = await backend.get('/api/salon/templates', {});
    expect(views(data).map((v) => v['purpose']), ['bill', 'booking', 'reminder', 'feedback']);
    expect((viewOf(data, 'bill')['current'] as Map)['state'], 'approved');
    expect(viewOf(data, 'booking')['current'], isNull);
    expect((viewOf(data, 'reminder')['current'] as Map)['state'], 'rejected');
    expect((viewOf(data, 'reminder')['current'] as Map)['reason'], contains('advert'));
    expect((viewOf(data, 'feedback')['current'] as Map)['state'], 'review');
    expect((viewOf(data, 'booking')['suggestion'] as Map)['text'], startsWith('Hi {Customer first name}, your appointment at {Business name}'));

    // A new wording for the approved bill: a new name, and the approved one kept until Meta approves it
    final bill = await app.ask('/api/salon/templates', {
      'purpose': 'bill',
      'text': 'Hello {Customer first name}, your bill {Bill number} from {Business name} is ready to view.',
      'language': 'en',
      'buttons': ['See bill'],
    });
    expect((bill['choice'] as Map)['name'], 'bill_ready_2');
    expect(((bill['choice'] as Map)['previous'] as Map)['name'], 'bill_ready');
    data = await backend.get('/api/salon/templates', {});
    final current = viewOf(data, 'bill')['current'] as Map;
    expect(current['state'], 'review');
    expect((current['previous'] as Map)['state'], 'approved');
    expect(current['text'], 'Hello {Customer first name}, your bill {Bill number} from {Business name} is ready to view.');
    expect(current['buttons'], ['See bill']);

    // What still needs fixing comes back in plain words
    await expectLater(
      app.ask('/api/salon/templates', {'purpose': 'booking', 'text': 'Hi {Pet name}, see you at the appointment.'}),
      throwsA(predicate((e) => '$e'.contains('{Pet name} is not a blank'))),
    );
  });

  test('Shop: switches, sending, and using a template it already has', () async {
    var data = await backend.get('/api/commerce/shop-messages', {});
    expect(views(data).length, 6);
    expect(viewOf(data, 'order_update')['switchable'], isFalse);
    expect((viewOf(data, 'cod_confirm')['current'] as Map)['buttons'], ['Yes, send it', 'Cancel order']);
    final sent = await app.ask('/api/commerce/shop-messages', {'purpose': 'cart_reminder', 'text': (viewOf(data, 'cart_reminder')['suggestion'] as Map)['text'], 'language': 'en'});
    expect((sent['setting'] as Map)['template'], 'cart_reminder');
    expect((sent['setting'] as Map)['fields'], ['first_name', 'cart_items', 'shop', 'cart_link']);
    await app.ask('/api/commerce/shop-messages', {
      'purpose': 'back_in_stock',
      'pick': {
        'template': 'cod_order_check',
        'language': 'en',
        'fields': ['product', 'shop', 'product_link', 'product'],
      },
    }, method: 'PUT');
    data = await backend.get('/api/commerce/shop-messages', {});
    expect((viewOf(data, 'cart_reminder')['current'] as Map)['state'], 'review');
    expect((viewOf(data, 'back_in_stock')['current'] as Map)['name'], 'cod_order_check');
    await app.ask('/api/commerce/shop-messages', {'purpose': 'back_in_stock', 'pick': null}, method: 'PUT');
    data = await backend.get('/api/commerce/shop-messages', {});
    expect(viewOf(data, 'back_in_stock')['current'], isNull);
  });

  testWidgets('the screen: send the suggestion, then edit a rejected one and send it again', (tester) async {
    tester.view.physicalSize = const Size(412, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(WamaApp(app: app, screen: 'setup_templates'));
    await settle(tester);
    expect(await reach(tester, find.text('Booking confirmed')), findsOneWidget);
    // The booking is the one not set up: send its suggested wording as it is
    await tapText(tester, 'Send for approval');
    // The demo answers after a real short wait, outside the test's own clock
    Future<Map> fresh() async => (await tester.runAsync(() => backend.get('/api/salon/templates', {})))!;
    expect((viewOf(await fresh(), 'booking')['current'] as Map)['state'], 'review');

    // The rejected reminder: Meta's reason, then edit and send again
    await tapText(tester, 'Edit and send again');
    expect(find.textContaining('Why Meta did not approve it'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'Hi there, a reminder of your visit at ');
    await tester.pump();
    await tapText(tester, '+ Time');
    expect(find.textContaining('5:00 pm'), findsWidgets, reason: 'the preview fills the blank with its example');
    await tapText(tester, '+ Business name');
    // Ends with a blank: the server's rule comes back on the screen, nothing is sent
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Send for approval'));
    await tester.tap(find.widgetWithText(FilledButton, 'Send for approval'));
    await settle(tester);
    expect(find.textContaining("can't start or end with a blank"), findsOneWidget);
    // Back up to the message box (the page builds only what is near the screen)
    await tester.drag(find.byType(Scrollable).last, const Offset(0, 3000), warnIfMissed: false);
    await settle(tester);
    await tester.enterText(find.byType(TextField).first, 'Hi {Customer first name}, a reminder of your visit at {Business name} today at {Time}. Reply here to change it.');
    await tester.pump();
    final send = await reach(tester, find.widgetWithText(FilledButton, 'Send for approval'));
    await tester.ensureVisible(send);
    await tester.tap(send);
    await settle(tester);
    expect(find.text('Message templates'), findsOneWidget, reason: 'back on the list');
    final reminder = viewOf(await fresh(), 'reminder')['current'] as Map;
    expect(reminder['state'], 'review');
    expect(reminder['name'], 'appointment_reminder_2');
    await tester.pumpWidget(const SizedBox());
    await settle(tester);
  });
}
