import 'package:flutter_test/flutter_test.dart';

import 'release_helpers.dart';

/// On the free trial with days left, WhatsApp connected: everything opens, no trial bar yet.
void main() {
  final r = releaseApp();

  testWidgets('the app opens normally on the trial, with no trial bar yet', (tester) async {
    await useApp(tester, r.app, () async {
      expect(r.app.paused, isFalse);
      expect(r.app.trialDaysLeft, 10);
      expect(find.text('Front Desk'), findsWidgets);
      expect(find.textContaining('left in your free trial'), findsNothing);
    });
  });

  testWidgets('WhatsApp connected: chats open with search', (tester) async {
    await useApp(tester, r.app, () async {
      expect(r.app.whatsappOn, isTrue);
      await tapText(tester, r.app.instagramOn ? 'WhatsApp' : 'Chats');
      expect(find.textContaining('Connect WhatsApp'), findsNothing);
      expect(find.textContaining('Search name'), findsOneWidget);
    });
  });

  testWidgets('More shows how long the free trial has left', (tester) async {
    await useApp(tester, r.app, () async {
      await tapText(tester, 'More');
      expect(find.text('Free trial · 10 days left'), findsOneWidget);
    });
  });
}
