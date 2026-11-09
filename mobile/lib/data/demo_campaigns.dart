/// The demo's answers for campaigns: the list with filters and totals, one campaign with who got
/// it and who replied, past-campaign recipients, senders, and stop / send again / scheduled actions.
class DemoCampaigns {
  DemoCampaigns({required this.campaigns, required this.contacts, required this.conversations});
  final List<Map<String, dynamic>> campaigns;
  final List<Map<String, dynamic>> contacts;
  final List<Map<String, dynamic>> conversations;

  static const _statusFilter = {
    'scheduled': ['SCHEDULED'],
    'sending': ['PROCESSING', 'PENDING', 'RUNNING'],
    'completed': ['COMPLETED'],
    'failed': ['FAILED'],
    'stopped': ['STOPPED', 'CANCELLED'],
  };

  Map<String, dynamic> get _summary {
    int n(List<String> s) => campaigns.where((c) => s.contains(c['status'])).length;
    num sum(String k) => campaigns.fold<num>(0, (t, c) => t + ((c[k] as num?) ?? 0));
    return {'total': campaigns.length, for (final e in _statusFilter.entries) e.key: n(e.value), 'recipients': sum('total_contacts'), 'sent': sum('sent_count'), 'failedMessages': sum('failed_count')};
  }

  /// Each contact with a number is in each campaign; the first few replied.
  List<Map<String, dynamic>> _people(Map<String, dynamic> c) {
    final status = '${c['status']}';
    final now = DateTime.now();
    final out = <Map<String, dynamic>>[];
    for (var i = 0; i < contacts.length; i++) {
      final p = contacts[i];
      final dispatch = switch (status) {
        'SCHEDULED' || 'STOPPED' => 'PENDING',
        'FAILED' => 'FAILED',
        _ => i == 7 ? 'FAILED' : (i % 3 == 0 ? 'DELIVERED' : 'READ'),
      };
      final conv = conversations.cast<Map<String, dynamic>?>().firstWhere((x) => x!['contact']?['id'] == p['id'], orElse: () => null);
      final replied = dispatch == 'READ' && conv != null && i < 6;
      out.add({
        'log_id': 'log-${c['id']}-$i',
        'phone_number': p['phone_number'],
        'dispatch_status': dispatch,
        'error_message': dispatch == 'FAILED' ? (status == 'FAILED' ? 'The template was paused by Meta.' : 'This number is not on WhatsApp.') : null,
        'variables_mapped': {'1': '${p['first_name']}'},
        'dispatched_at': c['created_at'],
        'contact_id': p['id'],
        'first_name': p['first_name'],
        'last_name': p['last_name'],
        'contact_phone': p['phone_number'],
        'conversation_id': replied ? conv['id'] : null,
        'unread_count': replied ? (conv['unread_count'] ?? 0) : 0,
        'last_message_at': replied ? conv['last_message_at'] : null,
        'has_replied': replied,
        'needs_reply': replied && (conv['unread_count'] as num? ?? 0) > 0,
        'last_message': replied ? conv['last_message'] : null,
        '_at': now.toIso8601String(),
      });
    }
    return out;
  }

  Map<String, dynamic>? get(String path, Map<String, String>? query) {
    switch (path) {
      case '/api/campaigns':
        final id = query?['id'];
        if (id != null) {
          final c = campaigns.firstWhere((c) => c['id'] == id);
          final people = _people(c);
          final replied = people.where((p) => p['has_replied'] == true).length;
          final total = (c['total_contacts'] as num?) ?? people.length;
          return {
            'success': true,
            'campaign': {
              ...c,
              'template_body': c['template_body'] ?? 'Hi {{1}}, get 20% off on all facials and hair spa till 15 Nov. Book on WhatsApp now!',
              'active_chats_count': replied,
              'unread_chats_count': people.where((p) => p['needs_reply'] == true).length,
              'reply_rate': total == 0 ? 0 : (replied * 100 / total).round(),
            },
            'logs': const [],
            'conversations': people,
          };
        }
        var list = [...campaigns];
        final status = query?['status'] ?? '';
        if (_statusFilter[status] != null) list = list.where((c) => _statusFilter[status]!.contains(c['status'])).toList();
        final search = (query?['search'] ?? '').toLowerCase();
        if (search.isNotEmpty) list = list.where((c) => '${c['name']} ${c['template_name']}'.toLowerCase().contains(search)).toList();
        return {
          'success': true,
          'campaigns': list,
          'summary': query?['all'] == 'true' || query?['summary'] == 'false' ? null : _summary,
          'pagination': {'total': list.length, 'page': 1, 'limit': 30, 'pages': 1},
        };
      case '/api/campaigns/participants':
        return {
          'success': true,
          'participantsByCampaign': {
            for (final id in (query?['campaignIds'] ?? '').split(','))
              if (id.isNotEmpty) id: [for (var i = 0; i < contacts.length; i += 2) contacts[i]['phone_number']],
          },
        };
      case '/api/campaigns/senders':
        return {
          'success': true,
          'whatsappSenders': [
            {'value': '+919876500000', 'label': 'Glow Salon · +91 98765 00000'},
            {'value': '+919876500001', 'label': 'Glow Salon Jubilee Hills · +91 98765 00001'},
          ],
        };
    }
    return null;
  }

  Map<String, dynamic>? send(String method, String path, Map<String, dynamic> body) {
    Map<String, dynamic> find() => campaigns.firstWhere((c) => c['id'] == body['campaignId']);
    switch (path) {
      case '/api/campaigns/stop':
        find()['status'] = 'STOPPED';
        return {'success': true};
      case '/api/campaigns/rerun':
        final c = find();
        c['status'] = 'RUNNING';
        if (body['rerunType'] == 'failed_only') c['failed_count'] = 0;
        return {'success': true};
      case '/api/campaigns/scheduled':
        find()['status'] = body['action'] == 'send_now' ? 'PROCESSING' : 'STOPPED';
        return {'success': true};
    }
    return null;
  }
}
