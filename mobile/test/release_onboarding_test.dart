import 'package:flutter_test/flutter_test.dart';

import 'release_helpers.dart';

/// Right after sign-up: the two connectors with their own WhatsApp, the ₹300 plan without it, then the pick in two steps.
void main() {
  final r = releaseApp(newSignup: true);

  testWidgets('new account: slides, then pick E-commerce without WhatsApp (small phone)', (tester) async {
    await useApp(tester, r.app, width: 320, height: 640, () async {
      expect(r.app.needsOnboarding, isTrue);
      // First: short videos on how we help, English on screen, the voice in English, Telugu or Hindi
      expect(find.text('Welcome! Your free trial has started'), findsOneWidget);
      expect(find.text('How we grow your business'), findsOneWidget);
      await tapText(tester, 'తెలుగు');
      expect(find.text('How we grow your business'), findsOneWidget, reason: 'Telugu changes only the voice, the words stay English');
      expect(find.text('మీ బిజినెస్‌ని మేము ఎలా పెంచుతాం'), findsNothing);
      await tapText(tester, 'English');
      await tapText(tester, 'Next');
      expect(find.text('Front Desk'), findsWidgets);
      expect(await reach(tester, find.textContaining('we run your Instagram, Facebook and Google ads')), findsOneWidget);
      await tapText(tester, 'Next');
      expect(find.text('E-commerce'), findsWidgets);
      await tapText(tester, 'Next');
      expect(find.text('Both work without WhatsApp, at ₹300 a month'), findsOneWidget);
      expect(await reach(tester, find.textContaining("from WAMA CRM's WhatsApp number")), findsOneWidget);
      await tapText(tester, 'Next');
      // Step 1 of 2: which connector, with who it is for
      expect(find.text('Pick what fits your business'), findsOneWidget);
      expect(await reach(tester, find.textContaining('Shops, boutiques', findRichText: true)), findsOneWidget);
      await tapText(tester, 'E-commerce');
      await tapText(tester, 'Next: your WhatsApp');
      // Step 2 of 2: with or without their own WhatsApp, what each includes
      expect(find.text('How should WhatsApp messages go out?'), findsOneWidget);
      expect(find.text('₹300 a month'), findsOneWidget);
      expect(await reach(tester, find.text('No chat inbox, AI replies or campaigns')), findsOneWidget);
      await tapText(tester, 'Without WhatsApp');
      await tapText(tester, 'Start using the app');
      expect(r.app.needsOnboarding, isFalse);
      expect(r.app.storeOn, isTrue, reason: 'E-commerce is the connector in use');
    });
  });
}
