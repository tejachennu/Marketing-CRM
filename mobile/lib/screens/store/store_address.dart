import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'store_screen.dart';

/// Where the online store opens: our free address, or the business's own domain (like Shopify).
/// Same API as the web (`/api/commerce/storefront/domain`).
class StoreAddressCard extends StatefulWidget {
  const StoreAddressCard({super.key, required this.canManage});
  final bool canManage;

  @override
  State<StoreAddressCard> createState() => _StoreAddressCardState();
}

class _StoreAddressCardState extends State<StoreAddressCard> {
  Map<String, dynamic>? _info;
  bool _own = false;
  bool _busy = false;
  String _error = '';
  final _domain = TextEditingController();

  @override
  void initState() {
    super.initState();
    _call('GET', show: false);
  }

  @override
  void dispose() {
    _domain.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>?> _call(String method, {Map<String, dynamic> body = const {}, bool show = true}) async {
    final app = AppScope.read(context);
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final data = method == 'GET'
          ? await app.backend.get('/api/commerce/storefront/domain', {'organizationId': app.orgId})
          : method == 'DELETE'
          ? await app.backend.send('DELETE', '/api/commerce/storefront/domain?organizationId=${app.orgId}', const {})
          : await app.ask('/api/commerce/storefront/domain', {'organizationId': app.orgId, ...body}, method: method);
      if (data['error'] != null) throw Exception('${data['error']}');
      if (!mounted) return null;
      setState(() {
        _info = data;
        if (data['domain'] != null) {
          _own = true;
          _domain.text = '${data['domain']}';
        }
      });
      return data;
    } catch (e) {
      if (mounted && show) setState(() => _error = plain(e));
      return null;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _useOurs() async {
    final current = _info?['domain'];
    if (current == null) {
      setState(() => _own = false);
      return;
    }
    final ok = await confirmAction(context, title: 'Stop using $current?', message: 'Your store goes back to our address.', yes: 'Stop using it', destructive: true);
    if (!ok || !mounted) return;
    final data = await _call('DELETE');
    if (data != null && mounted) {
      setState(() {
        _own = false;
        _domain.clear();
      });
      toast(context, 'Your store uses our address again.');
    }
  }

  Future<void> _connect() async {
    final data = await _call('PUT', body: {'domain': _domain.text.trim().toLowerCase()});
    if (data != null && mounted) toast(context, data['state'] == 'connected' ? 'Connected. Your store opens on your domain.' : 'Added. Now add the record at your domain company.');
  }

  Future<void> _check() async {
    final data = await _call('GET');
    if (data != null && mounted) toast(context, data['state'] == 'connected' ? 'Connected. Your store opens on your domain.' : 'Not working yet. Check the record, or wait a little longer.');
  }

  Widget _option(bool own, String title, String text, VoidCallback onTap) {
    final picked = _own == own;
    return InkWell(
      onTap: widget.canManage && !_busy ? onTap : null,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: picked ? Brand.blueSoft : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: picked ? Brand.blue : Brand.line),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(picked ? Icons.radio_button_checked : Icons.radio_button_unchecked, color: picked ? Brand.blue : Brand.faint, size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 2),
                  Text(text, style: const TextStyle(color: Brand.muted, fontSize: 13)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final info = _info;
    final domain = info?['domain'] as String?;
    final connected = info?['state'] == 'connected';
    final records = (info?['records'] as List? ?? const []).cast<Map>();
    final ours = '${info?['ourLink'] ?? ''}'.replaceFirst(RegExp('^https?://'), '');
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Store address', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          const Text('Use our free address, or open your store on your own domain, like shop.yourname.com.', style: TextStyle(color: Brand.muted, fontSize: 13)),
          const SizedBox(height: 10),
          _option(false, 'Our address (free)', ours.isEmpty ? 'wamacrm.magnetora.in/s/…' : ours, _useOurs),
          const SizedBox(height: 8),
          _option(true, 'My own domain', 'A domain you bought from GoDaddy, Hostinger or any other company.', () => setState(() => _own = true)),
          if (_own) ...[
            const SizedBox(height: 12),
            if (info != null && info['available'] == false && domain == null)
              const NoteBox(attention: true, icon: Icons.info_outline, text: 'Custom domains are not set up on WAMA yet. Please ask WAMA support.'),
            TextField(
              controller: _domain,
              enabled: widget.canManage && !_busy,
              keyboardType: TextInputType.url,
              autocorrect: false,
              decoration: const InputDecoration(labelText: 'Your domain', hintText: 'shop.yourname.com'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: !widget.canManage || _busy || _domain.text.trim().isEmpty || _domain.text.trim().toLowerCase() == domain ? null : _connect,
              icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.language, size: 18),
              label: Text(domain == null ? 'Connect' : 'Change'),
            ),
            if (_error.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _error,
                  style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600),
                ),
              ),
            if (domain != null) ...[
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(domain, style: const TextStyle(fontWeight: FontWeight.w600)),
                  Pill(connected ? 'Connected' : 'Waiting for your domain', tone: connected ? PillTone.blue : PillTone.red),
                ],
              ),
              const SizedBox(height: 6),
              Text('${info?['note'] ?? ''}', style: const TextStyle(color: Brand.muted, fontSize: 13)),
              if (!connected && records.isNotEmpty) ...[
                const SizedBox(height: 10),
                const Text('Add this at your domain company (DNS settings):', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                for (final r in records)
                  Container(
                    margin: const EdgeInsets.only(top: 8),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: Brand.lineSoft, borderRadius: BorderRadius.circular(10)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Type ${r['type']}   ·   Name ${r['name']}',
                          style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w600, fontSize: 13),
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            Expanded(
                              child: SelectableText('${r['value']}', style: const TextStyle(fontFamily: 'monospace', fontSize: 13)),
                            ),
                            IconButton(
                              tooltip: 'Copy',
                              icon: const Icon(Icons.copy, size: 18),
                              onPressed: () async {
                                await Clipboard.setData(ClipboardData(text: '${r['value']}'));
                                if (context.mounted) toast(context, 'Copied.');
                              },
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 6),
                const Text('Remove any other A or CNAME record with the same name first. It can take from a few minutes up to a day to work.', style: TextStyle(color: Brand.muted, fontSize: 12.5)),
              ],
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (!connected) OutlinedButton.icon(onPressed: _busy ? null : _check, icon: const Icon(Icons.refresh, size: 18), label: const Text('Check again')),
                  if (connected) OutlinedButton.icon(onPressed: () => openLink(context, 'https://$domain'), icon: const Icon(Icons.open_in_new, size: 18), label: const Text('Open')),
                  if (widget.canManage) OutlinedButton.icon(onPressed: _busy ? null : _useOurs, icon: const Icon(Icons.delete_outline, size: 18), label: const Text('Remove domain')),
                ],
              ),
            ],
          ],
        ],
      ),
    );
  }
}
