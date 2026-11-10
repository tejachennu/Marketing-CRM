import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'data/remote_config.dart';

import 'config.dart';
import 'data/app_state.dart';
import 'data/backend.dart';
import 'data/demo_backend.dart';
import 'data/format.dart';
import 'data/local_store.dart';
import 'screens/campaigns/audience.dart';
import 'screens/campaigns/campaign_screen.dart';
import 'screens/campaigns/campaigns_screen.dart';
import 'screens/campaigns/new_campaign_screen.dart';
import 'screens/chats/chat_screen.dart';
import 'screens/chats/chats_screen.dart';
import 'screens/chats/tickets_screen.dart';
import 'screens/contacts/contacts_screen.dart';
import 'screens/front_desk/appointment_screen.dart';
import 'screens/front_desk/bill_screen.dart';
import 'screens/front_desk/catalog_history.dart';
import 'screens/front_desk/checkout_screen.dart';
import 'screens/front_desk/reviews_team.dart';
import 'screens/front_desk/setup_screen.dart';
import 'screens/front_desk/setup_templates.dart';
import 'screens/front_desk/front_desk_screen.dart';
import 'screens/front_desk/logic.dart';
import 'screens/front_desk/new_bill_screen.dart';
import 'screens/front_desk/new_booking_screen.dart';
import 'screens/more/billing_screen.dart';
import 'screens/more/grow_screen.dart';
import 'screens/more/more_screens.dart';
import 'screens/templates/template_create.dart';
import 'screens/templates/template_editor.dart';
import 'screens/templates/template_model.dart';
import 'screens/templates/templates_screen.dart';
import 'screens/ai/assistant_screen.dart';
import 'screens/ai/knowledge_screen.dart';
import 'screens/front_desk/booking_flow_screen.dart';
import 'screens/front_desk/booking_try_screen.dart';
import 'screens/more/signup_screen.dart';
import 'ui/front_desk_icon.dart';
import 'ui/notice_host.dart';
import 'ui/splash.dart';
import 'ui/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final preview = AppConfig.demo ? Uri.base.queryParameters : const <String, String>{};
  // The opening animation while the app gets ready (not on demo screenshots of other screens)
  final splash = preview['screen'] == null || preview['screen'] == 'splash';
  if (splash) runApp(const SplashApp());
  if (preview['screen'] == 'splash') return;
  final shown = Future<void>.delayed(Duration(milliseconds: splash ? 1300 : 0));
  final store = LocalStore();
  await store.open();

  final Backend backend;
  if (AppConfig.demo) {
    backend = DemoBackend();
  } else {
    final config = await loadSignInConfig(store);
    if (config == null) {
      runApp(const _NeedsInternetApp());
      return;
    }
    await Supabase.initialize(url: config.url, publishableKey: config.key);
    backend = HttpBackend(Supabase.instance.client);
  }
  final app = AppState(backend: backend, store: store);

  if (AppConfig.demo) {
    await store.clear();
    await app.refreshAll();
    if (preview['offline'] == '1') await _demoOffline(app, backend as DemoBackend);
  }
  await app.start();
  await shown;
  runApp(WamaApp(app: app, screen: preview['screen']));
  // Demo: a customer writes and a booking request comes in (notification screenshots)
  if (AppConfig.demo && preview['incoming'] == '1') {
    Future<void>.delayed(const Duration(milliseconds: 1500), () => (backend as DemoBackend).simulateIncoming());
  }
}

/// Demo: the internet drops after the lists were saved, and a few changes are made offline.
Future<void> _demoOffline(AppState app, DemoBackend backend) async {
  backend.offline = true;
  app.online = false;
  final desk = FrontDesk(app);
  final start = fromIst(istNow(), 19, 30);
  await app.counterAction(
    kind: 'booking',
    label: 'Booking for Ananya Rao · today, 7:30 pm',
    localId: AppState.newLocalId(),
    resultIdPath: 'appointment.id',
    action: {
      'type': 'create_appointment',
      'customer': {'name': 'Ananya Rao', 'phone': '+919555512345'},
      'service_ids': ['s-cleanup'],
      'starts_at': start.toIso8601String(),
    },
    preview: {
      'day': istToday(),
      'customer_name': 'Ananya Rao',
      'customer_phone': '+919555512345',
      'starts_at': start.toIso8601String(),
      'ends_at': start.add(const Duration(minutes: 40)).toIso8601String(),
      'status': 'booked',
      'services': [desk.service('s-cleanup')],
      'staff_id': 'st-lakshmi',
    },
  );
  await app.counterAction(
    kind: 'bill',
    label: 'Bill for Vikram Singh · ₹2,800',
    localId: AppState.newLocalId(),
    resultIdPath: 'invoice.id',
    action: {
      'type': 'walk_in_bill',
      'customer': {'name': 'Vikram Singh', 'phone': '+919444455555'},
      'service_ids': ['s-menscut', 's-colour'],
      'payment_method': 'cash',
    },
    preview: {
      'customer_name': 'Vikram Singh',
      'total': 2800,
      'status': 'paid',
      'payment_method': 'cash',
      'issued_at': DateTime.now().toUtc().toIso8601String(),
      'items': [desk.service('s-menscut'), desk.service('s-colour')],
    },
  );
  await app.enqueue(
    kind: 'contact',
    label: 'New contact: Rohit Gupta',
    path: '/api/contacts',
    body: {
      'firstName': 'Rohit',
      'lastName': 'Gupta',
      'phoneNumber': '+919811122233',
      'tags': ['New'],
    },
  );
  await app.enqueue(
    kind: 'message',
    label: 'Message to Meera Joshi: Yes, 11 am tomorrow is free!',
    path: '/api/messages/send',
    body: {'conversationId': 'conv-5', 'message': 'Yes, 11 am tomorrow is free! Shall I book it?'},
  );
}

class WamaApp extends StatelessWidget {
  const WamaApp({super.key, required this.app, this.screen});
  final AppState app;

  /// Demo only: open one screen directly (for previews and screenshots).
  final String? screen;

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: app,
      child: MaterialApp(
        title: 'WAMA CRM',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        navigatorKey: navigatorKey,
        routes: {'/sync': (_) => const SyncScreen(), '/templates': (_) => const TemplatesScreen()},
        builder: (context, child) => NoticeHost(app: app, child: child ?? const SizedBox.shrink()),
        home: screen != null ? _preview(screen!) : const _Root(),
      ),
    );
  }

  Widget _preview(String name) {
    final desk = FrontDesk(app);
    return switch (name) {
      'login' => const LoginScreen(),
      'splash' => const SplashScreen(),
      'signup' => const SignupScreen(),
      'signup_code' => const SignupScreen(demoCodeStep: true),
      'chat_ai' => ChatScreen(conversation: Map<String, dynamic>.from((app.cached('conversations')!['conversations'] as List).first), showSuggestions: true),
      'knowledge' => const KnowledgeScreen(),
      'article' => ArticleScreen(article: Map<String, dynamic>.from((app.cached('knowledge')!['articles'] as List)[2])),
      'assistant' => const AssistantScreen(demoQuestion: 'How much is a gold facial?'),
      'booking_flow' => const BookingFlowScreen(),
      'booking_try' => BookingTryScreen(
        steps: [for (final x in (desk.settings['booking_flow'] as Map)['steps'] as List) Map<String, dynamic>.from(x as Map)],
        welcome: "Hi {name}! Let's book your visit at {business}. Which service would you like?",
        trigger: 'book',
        multiSelect: true,
        autoApprove: false,
      ),
      'booking_try_form' => BookingTryScreen(
        steps: [for (final x in (desk.settings['booking_flow'] as Map)['steps'] as List) Map<String, dynamic>.from(x as Map)],
        welcome: "Hi {name}! Let's book your visit at {business}. Which service would you like?",
        trigger: 'book',
        multiSelect: true,
        autoApprove: false,
        tickBoxes: true,
      ),
      'desk' => const HomeShell(),
      'requests' => const HomeShell(deskTab: 1),
      'bills' => const HomeShell(tab: 1),
      'reviews' => const ReviewsScreen(),
      'team' => const TeamScreen(),
      'setup' => const SetupScreen(),
      'setup_services' => const ServicesSetup(),
      'setup_catalog' => const CatalogScreen(),
      'setup_history' => const HistoryScreen(),
      'setup_team' => const StaffSetup(),
      'setup_business' => const BusinessSetup(),
      'setup_whatsapp' => const WhatsAppSetup(),
      'setup_templates' => const TemplatesSetup(),
      'checkout' => CheckoutScreen(appointment: desk.appointments.firstWhere((a) => a['status'] == 'in_service')),
      'new_bill' => const NewBillScreen(),
      'new_booking' => const NewBookingScreen(),
      'appointment' => AppointmentScreen(appointmentId: '${desk.appointments.firstWhere((a) => a['status'] == 'in_service')['id']}'),
      'bill' => BillScreen(invoiceId: '${desk.invoices.firstWhere((i) => i['status'] == 'unpaid')['id']}'),
      'bill_paid' => BillScreen(invoiceId: '${desk.invoices.firstWhere((i) => i['status'] == 'paid')['id']}'),
      'chats' => const HomeShell(tab: 2),
      'chat' => ChatScreen(conversation: Map<String, dynamic>.from((app.cached('conversations')!['conversations'] as List).first)),
      'chat_closed' => ChatScreen(conversation: Map<String, dynamic>.from((app.cached('conversations')!['conversations'] as List)[4])),
      'grow' => const GrowScreen(),
      'billing' => const BillingScreen(),
      'tickets' => const TicketsScreen(),
      'template_create' => TemplateSetupScreen(existing: [for (final t in (app.cached('templates')?['templates'] as List? ?? const [])) Map<String, dynamic>.from(t)]),
      'template_editor' => TemplateEditorScreen(draft: {...emptyDraft('MARKETING', 'custom'), 'name': 'weekend_offer'}),
      'template_editor_carousel' => TemplateEditorScreen(draft: {...emptyDraft('MARKETING', 'carousel'), 'name': 'new_looks'}),
      'template_editor_otp' => TemplateEditorScreen(draft: {...emptyDraft('AUTHENTICATION', 'otp'), 'name': 'login_code'}),
      'template_library' => const TemplateLibraryScreen(existing: {}),
      'template_insights' => TemplateInsightsScreen(template: Map<String, dynamic>.from((app.cached('templates')!['templates'] as List).first as Map)),
      'contacts' => const ContactsScreen(),
      'new_contact' => const NewContactScreen(),
      'campaigns' => const CampaignsScreen(),
      'new_campaign' => const NewCampaignScreen(),
      'campaign' => const CampaignScreen(campaignId: 'c1'),
      'campaign_scheduled' => const CampaignScreen(campaignId: 'c2'),
      'campaign_sending' => const CampaignScreen(campaignId: 'c3'),
      'choose_people' => const ChoosePeopleScreen(picked: null, filter: AudienceFilter()),
      'templates' => const TemplatesScreen(),
      'template' => TemplateScreen(template: Map<String, dynamic>.from((app.cached('templates')!['templates'] as List)[3])),
      'more' => const HomeShell(tab: 3),
      'sync' => const SyncScreen(),
      _ => const HomeShell(),
    };
  }
}

class _Root extends StatelessWidget {
  const _Root();
  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    return app.signedIn ? const HomeShell() : const LoginScreen();
  }
}

/// The tabs at the bottom, as WhatsApp's four: Front Desk, Bills, Chats, More (Contacts, Campaigns,
/// Reviews and Team are in More). Without Front Desk: Chats and More.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, this.tab = 0, this.deskTab = 0});
  final int tab;

  /// Front Desk's own tab: 0 Bookings, 1 Requests.
  final int deskTab;
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  late int _tab = widget.tab;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final unread = ((app.cached('conversations') ?? const {})['conversations'] as List? ?? const []).where((c) => ((c['unread_count'] as num?) ?? 0) > 0).length;
    final desk = app.frontDeskOn;
    final requests = desk ? FrontDesk(app).requests.length : 0;
    final pages = [
      if (desk) ...[FrontDeskScreen(initialTab: widget.deskTab), const BillsScreen()],
      const ChatsScreen(),
      const MoreScreen(),
    ];
    final tab = _tab.clamp(0, pages.length - 1);
    return Scaffold(
      body: IndexedStack(index: tab, children: pages),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: Brand.line)),
        ),
        child: NavigationBar(
          selectedIndex: tab,
          onDestinationSelected: (i) => setState(() => _tab = i),
          labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
          destinations: [
            if (desk) ...[
              NavigationDestination(
                icon: Badge(isLabelVisible: requests > 0, label: Text('$requests'), backgroundColor: Brand.green, child: const FrontDeskIcon(size: 24)),
                selectedIcon: Badge(isLabelVisible: requests > 0, label: Text('$requests'), backgroundColor: Brand.green, child: const FrontDeskIcon(size: 24, filled: true)),
                label: 'Front Desk',
              ),
              const NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long), label: 'Bills'),
            ],
            NavigationDestination(
              icon: Badge(isLabelVisible: unread > 0, label: Text('$unread'), backgroundColor: Brand.green, child: const Icon(Icons.chat_bubble_outline)),
              selectedIcon: Badge(isLabelVisible: unread > 0, label: Text('$unread'), backgroundColor: Brand.green, child: const Icon(Icons.chat_bubble)),
              label: 'Chats',
            ),
            NavigationDestination(
              icon: Badge(isLabelVisible: app.waitingCount > 0, label: Text('${app.waitingCount}'), backgroundColor: app.failedCount > 0 ? Brand.red : Brand.navy, child: const Icon(Icons.more_horiz)),
              label: 'More',
            ),
          ],
        ),
      ),
    );
  }
}

/// First start with no internet: the app needs to fetch its sign-in settings once.
class _NeedsInternetApp extends StatelessWidget {
  const _NeedsInternetApp();
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: buildTheme(),
    home: Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.wifi_off, size: 40, color: Brand.navy),
              const SizedBox(height: 16),
              const Text('Connect to the internet once', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              const Text('The first time, WAMA CRM needs the internet to set itself up and sign you in. After that it works offline too.', style: TextStyle(color: Brand.textSoft, height: 1.4)),
              const SizedBox(height: 20),
              FilledButton(onPressed: () => main(), child: const Text('Try again')),
            ],
          ),
        ),
      ),
    ),
  );
}
