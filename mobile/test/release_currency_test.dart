import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/data/format.dart';

import 'release_helpers.dart';

/// More → Currency: one currency for the whole business (bills, shop, deals), same list as the web.
void main() {
  group('money in the business currency', () {
    test('each currency has its own sign, rupees keep Indian grouping', () {
      expect(moneyIn(150000, 'INR'), '₹1,50,000');
      expect(moneyIn(99.5, 'INR'), '₹99.50');
      expect(moneyIn(150000, 'USD'), r'$150,000');
      expect(moneyIn(1250.5, 'AED'), 'AED 1,250.50');
      expect(moneyIn(10, 'GBP'), '£10');
      expect(moneyIn(10, 'XYZ'), '₹10', reason: 'not on the list: rupees');
      expect(currencySymbol('AED'), 'AED');
    });

    test('formatRupees follows the business, plan prices stay in rupees', () {
      final before = businessCurrencySource;
      businessCurrencySource = () => 'USD';
      expect(formatRupees(1499), r'$1,499');
      expect(shortRupees(2500000), r'$2.5M');
      expect(formatInr(1499), '₹1,499');
      businessCurrencySource = () => 'INR';
      expect(shortRupees(250000), '₹2.5L');
      businessCurrencySource = before;
    });
  });

  final r = releaseApp();

  testWidgets('owner changes the currency and amounts follow (320 × 640)', (tester) async {
    await useApp(tester, r.app, width: 320, height: 640, () async {
      await tester.tap(find.text('More').last);
      await settle(tester);
      expect(appCurrency, 'INR');
      await tapText(tester, 'Currency');
      expect(find.text('Saved'), findsOneWidget, reason: 'nothing changed yet');
      await tapText(tester, 'US dollar');
      await tapText(tester, 'Use us dollars');
      expect(appCurrency, 'USD', reason: 'the profile now says USD');
      expect(formatRupees(500), r'$500');
      expect(find.textContaining(r'US dollar ($)'), findsOneWidget, reason: 'More shows the new currency');
    });
  });
}
