import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/app_state.dart';
import 'package:wama_mobile/data/demo_backend.dart';
import 'package:wama_mobile/data/local_store.dart';
import 'package:wama_mobile/main.dart';
import 'package:wama_mobile/screens/front_desk/booking_steps.dart';

import 'screen_check.dart' show loadFonts;

void main() {
  test('Step rules match the server: what each step still needs', () {
    expect(stepProblem({'type': 'image', 'url': 'http://x.com/a.jpg'}), 'a picture');
    expect(stepProblem({'type': 'image', 'url': 'https://x.com/a.jpg'}), isNull);
    expect(stepProblem({'type': 'link', 'text': 'Prices', 'url': ''}), 'an https link');
    expect(stepProblem({'type': 'location'}), 'your address or a Google Maps link');
    expect(stepProblem({'type': 'location', 'address': 'Road 12'}), isNull);
    expect(
      stepProblem({
        'type': 'choice',
        'text': 'First visit?',
        'options': ['Yes'],
      }),
      'at least two answers',
    );
    expect(stepProblem({'type': 'services'}), isNull);
    expect(
      unfinishedStep([
        {'type': 'services'},
        {'type': 'message', 'text': ''},
        {'type': 'datetime'},
      ]),
      'Finish or remove step 2: it needs its words.',
    );
    expect(mapsCoordinates('https://www.google.com/maps/place/Glow/@17.4126,78.4482,17z'), (latitude: 17.4126, longitude: 78.4482));
    expect(mapsCoordinates('https://maps.app.goo.gl/xyz'), isNull);
    expect(stepWords({'type': 'datetime'}, name: 'Priya', business: 'Glow', service: 'Haircut'), 'Which day suits you for Haircut?');
    expect(stepWords({'type': 'message', 'text': 'Hi {name}, see you at {business}'}, name: 'Priya', business: 'Glow', service: ''), 'Hi Priya, see you at Glow');
  });

  testWidgets('Try it: tap through the whole flow as a customer, nothing sent', (tester) async {
    await loadFonts();
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    late AppState app;
    await tester.runAsync(() async {
      final dir = await Directory.systemTemp.createTemp('wama_try');
      final store = LocalStore();
      await store.open(path: dir.path);
      await store.clear();
      app = AppState(backend: DemoBackend(), store: store);
      await app.refreshAll();
    });
    await tester.pumpWidget(WamaApp(app: app, screen: 'booking_try'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    Future<void> tap(String startsWith) async {
      final f = find.byWidgetPredicate((w) => w is Text && (w.data ?? '').startsWith(startsWith));
      expect(f, findsWidgets, reason: 'No "$startsWith" on the screen: ${find.byType(Text).evaluate().map((e) => (e.widget as Text).data).whereType<String>().join(' | ')}');
      await tester.ensureVisible(f.last);
      await tester.pump();
      await tester.tap(f.last);
      await tester.pumpAndSettle();
    }

    bool shows(String part) => find.byWidgetPredicate((w) => w is Text && (w.data ?? '').contains(part), skipOffstage: false).evaluate().isNotEmpty;

    expect(shows("Let's book your visit at Glow Salon"), isTrue);
    await tap('Yes');
    await tap('Haircut (Women)');
    await tap('Continue');
    expect(shows('Any allergies'), isTrue);
    await tester.enterText(find.byType(TextField), 'No allergies');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pumpAndSettle();
    await tap('Anyone free');
    // The message, the map and the link go out on their own, in the business's words
    expect(shows('Please come 10 minutes early, Priya.'), isTrue);
    expect(shows('Here is how to find us:'), isTrue);
    expect(shows('See prices'), isTrue);
    expect(shows('When should we see you for Haircut (Women)?'), isTrue);
    await tap('Tomorrow');
    final time = find.byWidgetPredicate((w) => w is Text && RegExp(r'^\d{1,2}:\d{2} (am|pm)$').hasMatch(w.data ?? ''));
    await tester.ensureVisible(time.first);
    await tester.tap(time.first);
    await tester.pumpAndSettle();
    expect(shows('Thank you! We have your request for Haircut (Women)'), isTrue);
    expect(shows('Saved on the booking: First visit: Yes · Allergies: No allergies'), isTrue);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('Try it with tick boxes: one form, several services, then the next step', (tester) async {
    await loadFonts();
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    late AppState app;
    await tester.runAsync(() async {
      final dir = await Directory.systemTemp.createTemp('wama_try_form');
      final store = LocalStore();
      await store.open(path: dir.path);
      await store.clear();
      app = AppState(backend: DemoBackend(), store: store);
      await app.refreshAll();
    });
    await tester.pumpWidget(WamaApp(app: app, screen: 'booking_try_form'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    Future<void> tap(String startsWith) async {
      final f = find.byWidgetPredicate((w) => w is Text && (w.data ?? '').startsWith(startsWith));
      expect(f, findsWidgets, reason: 'No "$startsWith" on the screen');
      await tester.ensureVisible(f.last);
      await tester.pump();
      await tester.tap(f.last);
      await tester.pumpAndSettle();
    }

    bool shows(String part) => find.byWidgetPredicate((w) => w is Text && (w.data ?? '').contains(part), skipOffstage: false).evaluate().isNotEmpty;

    await tap('Yes');
    expect(shows("Can't open it? Reply LIST."), isTrue);
    // Nothing ticked: asked again
    await tap('Choose services');
    await tap('Continue');
    expect(shows('Please tick at least one service.'), isTrue);
    await tap('Choose services');
    await tap('Haircut (Women)');
    await tap('Gold facial');
    await tap('Continue');
    expect(shows('You picked: Haircut (Women), Gold facial'), isTrue);
    expect(shows('Any allergies'), isTrue);

    // LIST while the form is open gives the list instead
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(WamaApp(app: app, screen: 'booking_try_form'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tap('Yes');
    await tester.enterText(find.byType(TextField), 'list');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pumpAndSettle();
    expect(shows('Choose a service'), isTrue);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('Try it: a question gets the assistant\'s answer, then the booking carries on', (tester) async {
    await loadFonts();
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    late AppState app;
    await tester.runAsync(() async {
      final dir = await Directory.systemTemp.createTemp('wama_try_ask');
      final store = LocalStore();
      await store.open(path: dir.path);
      await store.clear();
      app = AppState(backend: DemoBackend(), store: store);
      await app.refreshAll();
    });
    await tester.pumpWidget(WamaApp(app: app, screen: 'booking_try'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    bool shows(String part) => find.byWidgetPredicate((w) => w is Text && (w.data ?? '').contains(part), skipOffstage: false).evaluate().isNotEmpty;
    Future<void> type(String text) async {
      await tester.enterText(find.byType(TextField), text);
      await tester.testTextInput.receiveAction(TextInputAction.send);
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 600)));
      await tester.pumpAndSettle();
    }

    await type('How much is gold facial?');
    expect(shows('Gold facial is ₹1,500 and takes about 60 minutes.'), isTrue);
    expect(shows('To carry on with your booking:'), isTrue);
    expect(find.byWidgetPredicate((w) => w is Text && (w.data ?? '').contains('Is this your first visit?')), findsNWidgets(2));
    expect(looksLikeQuestion('parking unda'), isTrue);
    expect(looksLikeQuestion('No allergies'), isFalse);
    await tester.pumpWidget(const SizedBox());
  });
}
