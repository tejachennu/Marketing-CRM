import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'store_logic.dart';
import 'store_screen.dart';

/// Store settings, as on the web: take orders on/off, the AI shopping assistant, the catalog (pick,
/// connect, create, rename, stop using, delete), the WhatsApp cart, the address form, payment and
/// shipping. Everything Meta knows is read from it, as on the web.
class StoreSettingsTab extends StatefulWidget {
  const StoreSettingsTab({super.key, required this.store});
  final StoreScreenState store;
  @override
  State<StoreSettingsTab> createState() => _StoreSettingsTabState();
}

class _StoreSettingsTabState extends State<StoreSettingsTab> with AutomaticKeepAliveClientMixin {
  Map get org => widget.store.org!;
  late final bool _expressEditable = org.containsKey('commerce_express_fee');
  late final bool _assistantEditable = org.containsKey('commerce_ai_assistant');
  late bool _neverSetUp =
      org['enable_commerce'] != true && '${org['meta_catalog_id'] ?? ''}'.isEmpty && '${org['commerce_gateway_config_name'] ?? ''}'.isEmpty && '${org['commerce_address_flow_id'] ?? ''}'.isEmpty;

  late bool _on = _neverSetUp ? true : org['enable_commerce'] != false;
  late bool _assistant = org['commerce_ai_assistant'] != false;
  late String _catalogId = '${org['meta_catalog_id'] ?? ''}';
  late String _gateway = supportedGateways.contains(org['commerce_payment_gateway']) ? '${org['commerce_payment_gateway']}' : 'razorpay';
  late String _config = '${org['commerce_gateway_config_name'] ?? ''}';
  late bool _cod = org['commerce_enable_cod'] != false;
  late String _flowId = '${org['commerce_address_flow_id'] ?? ''}';
  late final _shipping = TextEditingController(text: '${org['commerce_default_shipping_fee'] ?? 0}');
  late final _freeAbove = TextEditingController(text: '${org['commerce_free_shipping_threshold'] ?? 0}');
  late final _express = TextEditingController(text: '${expressFee(org)}');

  Map<String, dynamic>? _detected;
  String? _detectError;
  Map<String, dynamic>? _catalogInfo;
  bool _detecting = false, _saving = false, _cartBusy = false, _flowBusy = false;
  String? _catalogBusy;

  @override
  bool get wantKeepAlive => true;

  bool get _connected => StoreSetup(org).whatsappConnected;

  @override
  void initState() {
    super.initState();
    if (_connected) _detect(quiet: true);
  }

  @override
  void dispose() {
    _shipping.dispose();
    _freeAbove.dispose();
    _express.dispose();
    super.dispose();
  }

  Map<String, String> get _q => {'organizationId': AppScope.read(context).orgId};

  Future<void> _loadCatalogInfo() async {
    try {
      final data = await AppScope.read(context).backend.get('/api/commerce/catalog', _q);
      if (mounted) setState(() => _catalogInfo = data);
    } catch (_) {}
  }

  Future<void> _detect({bool quiet = false}) async {
    setState(() => _detecting = true);
    try {
      final results = await Future.wait([AppScope.read(context).backend.get('/api/commerce/meta-detect', _q), _loadCatalogInfo().then((_) => <String, dynamic>{})]);
      final data = results.first;
      if (!mounted) return;
      if (data['success'] == false) {
        setState(() {
          _detected = null;
          _detectError = '${data['connectionError'] ?? 'Meta could not be reached'}';
        });
        return;
      }
      setState(() {
        _detected = data;
        _detectError = null;
      });
      if (!quiet) toast(context, 'Refreshed from Meta.');
    } catch (e) {
      if (mounted) setState(() => _detectError = plain(e));
    } finally {
      if (mounted) setState(() => _detecting = false);
    }
  }

  Future<Map<String, dynamic>?> _catalogCall(String action, [Map<String, dynamic> extra = const {}]) async {
    setState(() => _catalogBusy = action);
    try {
      return await AppScope.read(context).ask('/api/commerce/catalog', {'action': action, ...extra});
    } catch (e) {
      if (mounted) await showMessage(context, 'Catalog not changed', plain(e));
      return null;
    } finally {
      if (mounted) setState(() => _catalogBusy = null);
    }
  }

  Future<void> _connectCatalog() async {
    final data = await _catalogCall('connect', {'catalogId': _catalogId.trim()});
    if (data == null || !mounted) return;
    widget.store.saved({'meta_catalog_id': data['catalogId']});
    await _loadCatalogInfo();
    if (mounted) toast(context, 'The catalog is connected to your WhatsApp account. Its products can now be sent and ordered in chats.');
  }

  Future<void> _createCatalog() async {
    final name = TextEditingController(text: '${org['name'] ?? 'My store'} catalog');
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('Create a catalog'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: name,
              autofocus: true,
              maxLength: 100,
              decoration: const InputDecoration(labelText: 'Catalog name'),
            ),
            Text(
              _detected?['businessName'] != null
                  ? 'Created in your business portfolio “${_detected!['businessName']}” and connected to your WhatsApp account.'
                  : 'Created in the business portfolio that owns your WhatsApp account, and connected to it.',
              style: const TextStyle(color: Brand.muted, fontSize: 13),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialog, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(dialog, true), child: const Text('Create and connect')),
        ],
      ),
    );
    if (ok != true || name.text.trim().isEmpty) return;
    final data = await _catalogCall('create', {'name': name.text.trim(), 'businessId': ?(_detected?['businessId'] ?? _catalogInfo?['businessId'])});
    if (data == null || !mounted) return;
    setState(() => _catalogId = '${data['catalogId']}');
    widget.store.saved({'meta_catalog_id': data['catalogId']});
    await _loadCatalogInfo();
    if (!mounted) return;
    if (data['connected'] == true) {
      toast(context, 'Your catalog was created and connected to WhatsApp. Add products in the Products tab.');
    } else {
      await showMessage(
        context,
        'Catalog created, but not connected',
        'The catalog was created and saved here. Connecting it to your WhatsApp account did not work: ${data['connectError'] ?? 'Meta did not say why.'} Tap “Connect to WhatsApp” to try again.',
      );
    }
  }

  Future<void> _renameCatalog(String current) async {
    final name = TextEditingController(text: current);
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('Rename the catalog'),
        content: TextField(
          controller: name,
          autofocus: true,
          maxLength: 100,
          decoration: const InputDecoration(labelText: 'New name'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialog, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(dialog, true), child: const Text('Save name')),
        ],
      ),
    );
    if (ok != true || name.text.trim().isEmpty) return;
    if (await _catalogCall('rename', {'name': name.text.trim()}) != null) {
      await _loadCatalogInfo();
      if (mounted) toast(context, 'The catalog was renamed.');
    }
  }

  Future<void> _unlinkCatalog() async {
    final ok = await confirmAction(
      context,
      title: 'Stop using this catalog here?',
      message: 'Products are no longer synced with it or sent from it here. The catalog and its products stay in Meta. It also stays connected to your WhatsApp account: to remove it from WhatsApp, open WhatsApp Manager → Account tools → Catalog and disconnect it there.',
      yes: 'Stop using',
      destructive: true,
    );
    if (!ok || await _catalogCall('unlink') == null) return;
    setState(() => _catalogId = '');
    widget.store.saved({'meta_catalog_id': ''});
    await _loadCatalogInfo();
    if (mounted) toast(context, 'This store no longer uses the catalog.');
  }

  Future<void> _deleteCatalog(String? name) async {
    final linked = '${_catalogInfo?['linkedCatalogId'] ?? ''}';
    if (linked.isEmpty) return;
    final ok = await confirmAction(
      context,
      title: 'Delete the catalog in Meta?',
      message: 'This deletes the catalog ${name != null ? '“$name” ' : ''}and every product in it from Meta, for WhatsApp and anything else using it. Your products stay here. This cannot be undone.',
      yes: 'Delete catalog',
      destructive: true,
    );
    if (!ok) return;
    final data = await _catalogCall('delete', {'confirm': linked});
    if (data == null) return;
    setState(() => _catalogId = '');
    widget.store.saved({'meta_catalog_id': ''});
    await _loadCatalogInfo();
    final kept = (data['productsReset'] as num? ?? 0) > 0 ? ' ${data['productsReset']} products stay here, ready for another catalog.' : '';
    if (mounted) toast(context, 'The catalog was deleted in Meta.$kept');
  }

  Future<void> _cart(bool on) async {
    if (!on) {
      final ok = await confirmAction(
        context,
        title: 'Turn off the cart?',
        message: 'Customers can still see your catalog on WhatsApp, but they cannot add products to a cart or send one to you. You can turn it on again any time.',
        yes: 'Turn off cart',
        destructive: true,
      );
      if (!ok || !mounted) return;
    }
    setState(() => _cartBusy = true);
    try {
      await AppScope.read(context).ask('/api/commerce/meta-detect', {'action': on ? 'enable_cart' : 'disable_cart'});
      setState(
        () => _detected = {
          ...?_detected,
          'commerceSettings': {...?(_detected?['commerceSettings'] as Map?), 'is_cart_enabled': on, if (on) 'is_catalog_visible': true},
        },
      );
      if (mounted) toast(context, on ? 'Cart and catalog are now visible on your WhatsApp number.' : 'The cart is turned off on your WhatsApp number.');
    } catch (e) {
      if (mounted) await showMessage(context, on ? 'Cart not turned on' : 'Cart not turned off', plain(e));
    } finally {
      if (mounted) setState(() => _cartBusy = false);
    }
  }

  Future<void> _deployFlow() async {
    setState(() => _flowBusy = true);
    try {
      final data = await AppScope.read(context).ask('/api/commerce/meta-detect', {'action': 'deploy_address_flow'});
      if (data['flowId'] == null) throw Exception(data['error'] ?? 'The address form could not be published');
      setState(() => _flowId = '${data['flowId']}');
      widget.store.saved({'commerce_address_flow_id': data['flowId']});
      await _detect(quiet: true);
      if (mounted) toast(context, 'The delivery address form is published and will be sent after each order.');
    } catch (e) {
      if (mounted) await showMessage(context, 'Address form not published', plain(e));
    } finally {
      if (mounted) setState(() => _flowBusy = false);
    }
  }

  Future<void> _save() async {
    final shipping = num.tryParse(_shipping.text.trim());
    final freeAbove = num.tryParse(_freeAbove.text.trim());
    final express = num.tryParse(_express.text.trim());
    if ([shipping, freeAbove, if (_expressEditable) express].any((x) => x == null || x < 0)) {
      toast(context, 'Shipping amounts must be 0 or more.');
      return;
    }
    setState(() => _saving = true);
    final update = <String, dynamic>{
      'enable_commerce': _on,
      'meta_catalog_id': _catalogId.trim().isEmpty ? null : _catalogId.trim(),
      'commerce_payment_gateway': _gateway,
      'commerce_gateway_config_name': _config.trim().isEmpty ? null : _config.trim(),
      'commerce_enable_cod': _cod,
      'commerce_default_shipping_fee': shipping,
      'commerce_free_shipping_threshold': freeAbove,
      'commerce_address_flow_id': _flowId.trim().isEmpty ? null : _flowId.trim(),
      if (_expressEditable) 'commerce_express_fee': express,
      if (_assistantEditable) 'commerce_ai_assistant': _assistant,
    };
    try {
      await AppScope.read(context).ask('/api/organization', {'updates': update}, method: 'PATCH');
      widget.store.saved(update);
      _neverSetUp = false;
      if (mounted) toast(context, _on ? 'Store settings saved.' : 'Store settings saved. The store is switched off, so new carts are not turned into orders.');
    } catch (e) {
      if (mounted) await showMessage(context, 'Settings not saved', plain(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final currency = '${org['currency'] ?? 'INR'}';
    final info = _catalogInfo;
    final catalogs = [
      for (final c in ((info?['catalogs'] as List?)?.isNotEmpty == true ? info!['catalogs'] as List : (_detected?['catalogs'] as List? ?? const []))) Map<String, dynamic>.from(c as Map),
    ];
    final chosen = catalogs.where((c) => '${c['id']}' == _catalogId).firstOrNull;
    final isLinked = info != null && _catalogId.isNotEmpty && _catalogId == '${info['linkedCatalogId']}';
    final settings = _detected?['commerceSettings'] as Map?;
    final cartOn = settings == null ? null : settings['is_cart_enabled'] == true && settings['is_catalog_visible'] == true;
    final flows = [
      for (final f in (_detected?['flows'] as List? ?? const []))
        if (f['status'] == 'PUBLISHED') Map<String, dynamic>.from(f as Map),
    ];
    final setups = [for (final c in (_detected?['paymentConfigs'] as List? ?? const [])) Map<String, dynamic>.from(c as Map)];
    final chosenSetup = setups.where((c) => c['configuration_name'] == _config).firstOrNull;
    final hasOnline = _config.trim().isNotEmpty;

    Widget card(String title, String subtitle, List<Widget> children) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            if (subtitle.isNotEmpty) Text(subtitle, style: const TextStyle(color: Brand.muted, fontSize: 13)),
            const SizedBox(height: 10),
            ...children,
          ],
        ),
      ),
    );
    Widget hint(String text) => Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Text(text, style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
    );

    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
      children: [
        Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: SwitchListTile(
            value: _on,
            onChanged: (v) => setState(() => _on = v),
            title: const Text('Take orders on WhatsApp', style: TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text(
              _on
                  ? 'A cart sent from your catalog becomes an order, and the customer is taken through address and payment.'
                  : 'Switched off: carts are not turned into orders and customers get no checkout messages.',
            ),
          ),
        ),
        Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: SwitchListTile(
            value: _assistantEditable ? _assistant : true,
            onChanged: _assistantEditable ? (v) => setState(() => _assistant = v) : null,
            title: const Text('AI shopping assistant', style: TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text(
              !_assistantEditable
                  ? 'On. Answers product and order questions in the chat with your own products and the customer\'s orders.'
                  : _assistant
                  ? 'Answers “do you have…” and “where is my order?” in the chat: searches your products, sends product cards and reads the customer\'s own orders. Needs the AI chatbot to be on.'
                  : 'Off: product and order questions go to your FAQ chatbot like any other message.',
            ),
          ),
        ),
        card(
          'From your WhatsApp Business account',
          !_connected
              ? 'Connect WhatsApp in Settings on the web first: the catalog, payment setup and address form are chosen from it.'
              : _detected != null
              ? 'Catalogs, payment setups and forms are read from Meta${_detected!['businessName'] != null ? ' for ${_detected!['businessName']}' : ''}.'
              : (_detectError != null ? 'Meta could not be read.' : 'Reading your catalogs, payment setups and forms from Meta…'),
          [
            if (_detectError != null) NoteBox(attention: true, icon: Icons.error_outline, text: _detectError!),
            OutlinedButton.icon(
              onPressed: _detecting || !_connected ? null : () => _detect(),
              icon: _detecting ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.refresh),
              label: Text(_detecting ? 'Reading…' : 'Refresh from Meta'),
            ),
          ],
        ),
        card('Catalog', 'The Meta catalog whose products customers can add to a WhatsApp cart.', [
          DropdownButtonFormField<String>(
            initialValue: _catalogId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Catalog'),
            items: [
              DropdownMenuItem(value: '', child: Text(catalogs.isNotEmpty ? 'Choose your catalog…' : 'No catalog found on Meta')),
              if (_catalogId.isNotEmpty && chosen == null)
                DropdownMenuItem(
                  value: _catalogId,
                  child: Text('Saved catalog $_catalogId', overflow: TextOverflow.ellipsis),
                ),
              for (final c in catalogs)
                DropdownMenuItem(
                  value: '${c['id']}',
                  child: Text('${c['name'] ?? 'Catalog'} · ${c['product_count'] ?? 0} products${c['connected'] == true ? ' · connected' : ''}', overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: _connected ? (v) => setState(() => _catalogId = v ?? '') : null,
          ),
          hint(
            _detected?['catalogsError'] != null && catalogs.isEmpty
                ? 'Meta did not list your catalogs: ${_detected!['catalogsError']}'
                : 'Read from your WhatsApp Business account. WhatsApp sells from one catalog per account.',
          ),
          if (info != null && _catalogId.isNotEmpty) ...[
            const SizedBox(height: 8),
            if (isLinked && info['linkedError'] != null) NoteBox(attention: true, icon: Icons.error_outline, text: '${info['linkedError']}'),
            if (chosen != null) _ok('${chosen['name']} has ${chosen['product_count']} product${chosen['product_count'] == 1 ? '' : 's'} on Meta.'),
            if (chosen != null && info['connectionKnown'] == true)
              chosen['connected'] == true
                  ? _ok('It is connected to your WhatsApp account.')
                  : NoteBox(
                      attention: true,
                      icon: Icons.link_off,
                      text: 'It is not connected to your WhatsApp account, so its products cannot be sent or ordered in chats yet.',
                      action: TextButton(onPressed: _catalogBusy != null ? null : _connectCatalog, child: Text(_catalogBusy == 'connect' ? 'Connecting…' : 'Connect to WhatsApp')),
                    ),
            if (isLinked && info['canEdit'] == true) _ok('Products you add or change in the Products tab are sent to this catalog.'),
            if (isLinked && info['canEdit'] == false)
              const NoteBox(
                attention: true,
                icon: Icons.lock_outline,
                text: 'This WhatsApp connection can read the catalog but not change it, so products added here stay out of WhatsApp. To manage the catalog from here, use “Connect catalog with Meta” on the web.',
              ),
            if (!isLinked) hint('Save the store settings to use this catalog.'),
            if (isLinked)
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (info['canEdit'] == true) OutlinedButton(onPressed: _catalogBusy != null ? null : () => _renameCatalog('${chosen?['name'] ?? ''}'), child: const Text('Rename')),
                  OutlinedButton(onPressed: _catalogBusy != null ? null : _unlinkCatalog, child: const Text('Stop using here')),
                  if (info['canEdit'] == true)
                    OutlinedButton(
                      style: OutlinedButton.styleFrom(foregroundColor: Brand.red),
                      onPressed: _catalogBusy != null ? null : () => _deleteCatalog(chosen?['name']?.toString()),
                      child: const Text('Delete catalog'),
                    ),
                ],
              ),
          ],
          if (_connected && _catalogId.isEmpty)
            NoteBox(
              text:
                  'No catalog yet? Create one on Meta and connect it to your WhatsApp account in one step.${info?['canCreate'] == false ? ' This needs a WhatsApp connection that is allowed to manage catalogs.' : ''}',
              action: TextButton(onPressed: _catalogBusy != null ? null : _createCatalog, child: Text(_catalogBusy == 'create' ? 'Creating…' : 'Create a catalog')),
            ),
          if (_connected && info != null && info['catalogConnection'] != true && info['canEdit'] != true)
            NoteBox(
              text: 'To add, change and delete products in your Meta catalog from here, give access to your catalog in Meta\'s window. That step opens on the web.',
              action: TextButton(onPressed: () => openLink(context, 'https://wamacrm.magnetora.in/dashboard/commerce?tab=settings'), child: const Text('Open on web')),
            ),
          const SizedBox(height: 4),
          Row(
            children: [
              Icon(cartOn == true ? Icons.check_circle : Icons.shopping_bag_outlined, size: 20, color: cartOn == true ? Brand.blue : Brand.faint),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  cartOn == true
                      ? 'The cart and catalog buttons are showing on your WhatsApp number.'
                      : cartOn == false
                      ? 'The cart or catalog button is off on your WhatsApp number, so customers cannot send a cart.'
                      : 'Customers need the cart and catalog buttons on your WhatsApp number to send an order.',
                  style: const TextStyle(fontSize: 13.5),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          OutlinedButton(onPressed: _cartBusy || !_connected ? null : () => _cart(cartOn != true), child: Text(_cartBusy ? 'Please wait…' : (cartOn == true ? 'Turn off cart' : 'Turn on cart'))),
        ]),
        card('Delivery address', 'Optional. When set, customers get an address form right after they send a cart, before they are asked to pay.', [
          DropdownButtonFormField<String>(
            initialValue: _flowId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Address form'),
            items: [
              const DropdownMenuItem(value: '', child: Text('No address step')),
              if (_flowId.isNotEmpty && !flows.any((f) => '${f['id']}' == _flowId))
                DropdownMenuItem(
                  value: _flowId,
                  child: Text('Saved form $_flowId${_detected != null ? ' (not published)' : ''}', overflow: TextOverflow.ellipsis),
                ),
              for (final f in flows)
                DropdownMenuItem(
                  value: '${f['id']}',
                  child: Text('${f['name']}', overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: _connected ? (v) => setState(() => _flowId = v ?? '') : null,
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _flowBusy || !_connected ? null : _deployFlow,
            icon: _flowBusy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.auto_awesome_outlined),
            label: Text(_flowBusy ? 'Publishing…' : 'Create the standard form'),
          ),
          hint(
            _detected?['flowsError'] != null
                ? 'Meta did not list your forms: ${_detected!['flowsError']}'
                : '“Create the standard form” publishes a ready-made address form and selects it. It shows the express delivery charge set below, so save shipping first if you change that.',
          ),
        ]),
        card(
          'Payment',
          hasOnline && _cod
              ? 'Customers choose between paying online in the chat and Cash on Delivery.'
              : hasOnline
              ? 'Customers are asked to pay online in the chat.'
              : (_cod ? 'Customers confirm the order as Cash on Delivery with one tap.' : 'Choose at least one way for customers to pay.'),
          [
            DropdownButtonFormField<String>(
              initialValue: _config,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Online payment'),
              items: [
                const DropdownMenuItem(value: '', child: Text('No online payment')),
                if (_config.isNotEmpty && chosenSetup == null)
                  DropdownMenuItem(
                    value: _config,
                    child: Text('Saved setup “$_config” · ${gatewayLabels[_gateway] ?? _gateway}', overflow: TextOverflow.ellipsis),
                  ),
                for (final c in setups)
                  DropdownMenuItem(
                    value: '${c['configuration_name']}',
                    enabled: supportedGateways.contains('${c['provider_name'] ?? ''}'.toLowerCase()),
                    child: Text(
                      '${c['configuration_name']} · ${gatewayLabels['${c['provider_name'] ?? ''}'.toLowerCase()] ?? c['provider_name'] ?? 'gateway'}${c['status'] != null ? ' · ${c['status']}' : ''}${supportedGateways.contains('${c['provider_name'] ?? ''}'.toLowerCase()) ? '' : ' · not supported'}',
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: _connected
                  ? (v) => setState(() {
                      _config = v ?? '';
                      final provider = '${setups.where((c) => c['configuration_name'] == _config).firstOrNull?['provider_name'] ?? ''}'.toLowerCase();
                      if (supportedGateways.contains(provider)) _gateway = provider;
                    })
                  : null,
            ),
            hint(
              _detected?['paymentConfigsError'] != null
                  ? 'Meta did not list your payment setups: ${_detected!['paymentConfigsError']}'
                  : _detected != null && setups.isEmpty
                  ? 'No payment setup on your WhatsApp account yet. Add one in WhatsApp Manager → Payments (Razorpay, PayU, BillDesk or Zaakpay), then Refresh from Meta.'
                  : 'In-chat payment is for businesses in India, in rupees.',
            ),
            if (chosenSetup != null && '${chosenSetup['status'] ?? ''}'.isNotEmpty && '${chosenSetup['status']}'.toLowerCase() != 'active')
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: NoteBox(
                  attention: true,
                  icon: Icons.error_outline,
                  text:
                      '“${chosenSetup['configuration_name']}” is not ready on Meta (${chosenSetup['status']}). In WhatsApp Manager → Payments, open it and finish the steps Meta shows, then Refresh from Meta. Until it is Active, online payment requests fail${_cod ? ' and customers can only use Cash on Delivery' : ''}.',
                ),
              ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _cod,
              onChanged: (v) => setState(() => _cod = v ?? true),
              title: const Text('Allow Cash on Delivery'),
              subtitle: const Text('Customers confirm the order with one tap and pay when it arrives.'),
            ),
            if (!hasOnline && !_cod)
              const NoteBox(
                attention: true,
                icon: Icons.error_outline,
                text: 'With no online payment and no Cash on Delivery, customers can place an order but cannot pay in the chat. They will only be told that your team will contact them.',
              ),
          ],
        ),
        card('Shipping', 'Amounts are in $currency, your workspace currency.', [
          TextField(
            controller: _shipping,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Shipping fee', helperText: 'Added to every order.'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _freeAbove,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Free shipping on orders from', helperText: 'Use 0 to always charge the shipping fee.'),
          ),
          const SizedBox(height: 12),
          if (_expressEditable)
            TextField(
              controller: _express,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Express delivery charge', helperText: 'Added when the customer picks express in the address form.'),
            )
          else
            hint('Customers who pick express delivery in the address form are charged a further ${formatMoney(defaultExpressFee, currency)}.'),
        ]),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Save store settings'),
        ),
      ],
    );
  }

  Widget _ok(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.check_circle, size: 18, color: Brand.blue),
        const SizedBox(width: 8),
        Expanded(child: Text(text, style: const TextStyle(fontSize: 13.5))),
      ],
    ),
  );
}
