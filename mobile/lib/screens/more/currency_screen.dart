import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// The business's currency (as on the web's Settings → Currency): one for Front Desk bills, the shop and the
/// sales pipeline. Everyone sees it; owners and admins change it. Saved with PUT /api/settings/currency.
class CurrencyScreen extends StatefulWidget {
  const CurrencyScreen({super.key});
  @override
  State<CurrencyScreen> createState() => _CurrencyScreenState();
}

class _CurrencyScreenState extends State<CurrencyScreen> {
  late String _picked = appCurrency;
  bool _saving = false;

  Future<void> _save() async {
    final app = AppScope.read(context);
    setState(() => _saving = true);
    try {
      await app.ask('/api/settings/currency', {'currency': _picked}, method: 'PUT');
      await app.load('me', '/api/mobile/me', force: true);
      if (mounted) {
        toast(context, 'Currency saved. Amounts now show in ${currencyInfo(_picked).name.toLowerCase()}s.');
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) toast(context, '$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final canChange = app.can('settings');
    final changed = _picked != appCurrency;
    return Scaffold(
      appBar: AppBar(title: const Text('Currency')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Text(
            canChange
                ? 'Bills, invoices, products, your online store, deals and reports show money in this currency. Prices you saved stay as they are: only the sign changes.'
                : 'Bills, products, deals and reports show money in this currency. Ask the owner or an admin to change it.',
            style: const TextStyle(fontSize: 14.5, color: Brand.muted, height: 1.35),
          ),
          const SizedBox(height: 12),
          Card(
            child: RadioGroup<String>(
              groupValue: _picked,
              onChanged: (v) {
                if (canChange && v != null && !_saving) setState(() => _picked = v);
              },
              child: Column(
                children: [
                  for (final c in currencies)
                    RadioListTile<String>(
                      value: c.code,
                      enabled: canChange && !_saving,
                      title: Text(c.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text('${c.code} · ${moneyIn(1250, c.code)}'),
                      secondary: Text(c.symbol.trim(), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: KeyboardBar.wrap(canChange
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: FilledButton(
                  onPressed: changed && !_saving ? _save : null,
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                  child: _saving ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white)) : Text(changed ? 'Use ${currencyInfo(_picked).name.toLowerCase()}s' : 'Saved'),
                ),
              ),
            )
          : null),
    );
  }
}
