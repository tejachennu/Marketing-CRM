import 'package:flutter_test/flutter_test.dart';

import 'release_helpers.dart';

/// Right after sign-up: the two connectors with their own WhatsApp, the ₹300 plan without it, then the pick.
void main() {
  final r = releaseApp(newSignup: true);

  testWidgets('new account: slides, then pick E-commerce without WhatsApp (small phone)', (tester) async {
    await useApp(tester, r.app, width: 320, height: 640, () async {
      expect(r.app.needsOnboarding, isTrue);
      expect(find.text('Front Desk'), findsWidgets);
      expect(await reach(tester, find.textContaining('we run your Instagram, Facebook and Google ads')), findsOneWidget);
      await tapText(tester, 'Next');
      expect(find.text('E-commerce'), findsWidgets);
      await tapText(tester, 'Next');
      expect(find.text('Both work without WhatsApp, at ₹300 a month'), findsOneWidget);
      expect(await reach(tester, find.textContaining("from WAMA CRM's WhatsApp number")), findsOneWidget);
      await tapText(tester, 'Next');
      expect(find.text('Pick what fits your business'), findsOneWidget);
      await tapText(tester, 'E-commerce');
      await tapText(tester, 'Without WhatsApp · ₹300 a month');
      await tapText(tester, 'Start using the app');
      expect(r.app.needsOnboarding, isFalse);
      expect(r.app.storeOn, isTrue, reason: 'E-commerce is the connector in use');
    });
  });
}
