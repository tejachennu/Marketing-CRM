import 'package:flutter_test/flutter_test.dart';

import 'release_helpers.dart';

/// Starter (₹300, no own WhatsApp): Front Desk, bills and reports work; chats ask to move to the Business plan (₹999).
void main() {
  final r = releaseApp(starter: true);

  testWidgets('Front Desk and Bills work; Chats offers See plans (small phone)', (tester) async {
    await useApp(tester, r.app, width: 320, height: 640, () async {
      expect(r.app.sharedWhatsApp, isTrue);
      expect(find.text('Bookings'), findsWidgets);
      await tapText(tester, 'Bills');
      await tapText(tester, r.app.instagramOn ? 'WhatsApp' : 'Chats');
      expect(find.text('Your own WhatsApp comes with the Business plan'), findsOneWidget);
      await tapText(tester, 'See plans');
      expect(find.text('Billing'), findsWidgets);
    });
  });
}
