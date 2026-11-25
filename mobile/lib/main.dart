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
import 'screens/instagram/instagram_screen.dart';
import 'screens/more/connectors_screen.dart';
import 'screens/more/more_screens.dart';
import 'screens/store/new_order_screen.dart';
import 'screens/store/shop_more.dart' show ShopReportsScreen, shopMessagesScreen;
import 'screens/store/store_screen.dart';
import 'screens/store/website_screen.dart';
import 'screens/more/chat_tickets_screen.dart';
import 'screens/templates/template_create.dart';
import 'screens/templates/template_editor.dart';
import 'screens/templates/template_model.dart';
import 'screens/templates/templates_screen.dart';
import 'screens/ai/assistant_screen.dart';
import 'screens/ai/knowledge_screen.dart';
import 'screens/front_desk/booking_flow_screen.dart';
import 'screens/front_desk/booking_try_screen.dart';
import 'screens/auth/login_screen.dart';
import 'screens/auth/auth_parts.dart';
import 'screens/auth/signup_screen.dart';
import 'screens/more/delete_account_screen.dart';
import 'screens/more/expenses_screen.dart';
import 'ui/front_desk_icon.dart';
import 'ui/notice_host.dart';
import 'ui/splash.dart';
import 'ui/theme.dart';
import 'screens/onboarding/onboarding_screen.dart';
import 'screens/explainers/explainer_player.dart';
import 'ui/plan_lock.dart';
import 'ui/whatsapp_lock.dart';
import 'screens/store/online_payments.dart';
import 'screens/front_desk/website_settings_screen.dart';
import 'screens/front_desk/members_screen.dart';
import 'screens/ai/ai_tools.dart';

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
    backend = DemoBackend(billing: preview['billing'] ?? 'trial', staff: preview['staff'] == '1', whatsapp: preview['nowa'] != '1', starter: preview['starter'] == '1', appointments: preview['walkin'] != '1');
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
      'login_signin' => const LoginScreen(startOnSignIn: true),
      'delete_account' => const DeleteAccountScreen(),
      'expenses' => const ExpensesScreen(),
      'expense_new' => const ExpenseFormScreen(month: '2026-11'),
      'expense_kinds' => const Scaffold(body: SafeArea(child: CategorySearchSheet(selected: 'rent', own: ['Tea and snacks', 'Cleaning']))),
      'splash' => const SplashScreen(),
      'signup' => const SignupScreen(),
      'signup_code' => const SignupScreen(demoCodeStep: true),
      'connectors' => const ConnectorsScreen(),
      'whatsapp_locked' => const WhatsAppLockedScreen(feature: 'Chats'),
      'onboarding' => const OnboardingScreen(),
      'onboarding_desk' => const OnboardingScreen(startPage: 1),
      'onboarding_store' => const OnboardingScreen(startPage: 2),
      'onboarding_nowa' => const OnboardingScreen(startPage: 3),
      'onboarding_pick' => const OnboardingScreen(startPage: 4),
      'onboarding_whatsapp' => const OnboardingScreen(startPage: 5),
      'video' => const ExplainerScreen(startId: 'grow', autoplay: false),
      'video_ads' => const ExplainerScreen(startId: 'ads', autoplay: false),
      'video_website' => const ExplainerScreen(startId: 'website', autoplay: false),
      'video_sources' => const ExplainerScreen(startId: 'website', autoplay: false, startScene: 2, holdAt: 0.8),
      'video_end' => const ExplainerScreen(startId: 'grow', autoplay: false, showEnd: true),
      'video_instagram' => const ExplainerScreen(startId: 'instagram', autoplay: false, holdAt: 0.9),
      'video_ig_chat' => const ExplainerScreen(startId: 'instagram', autoplay: false, startScene: 1, holdAt: 0.9),
      'videos' => const ExplainerLibraryScreen(),
      'more' => const HomeShell(tab: 4),
      'chat_ai' => ChatScreen(conversation: app.chatsOf('whatsapp').first, showSuggestions: true),
      'instagram' => const InstagramScreen(),
      'instagram_comments' => const InstagramScreen(initialTab: 1),
      'instagram_posts' => const InstagramScreen(initialTab: 2),
      'instagram_auto' => const InstagramScreen(initialTab: 3),
      'ig_chat' => ChatScreen(conversation: app.chatsOf('instagram').first),
      'ig_chat_closed' => ChatScreen(conversation: app.chatsOf('instagram').last),
      'shop_reports' => const ShopReportsScreen(currency: 'INR'),
      'shop_messages' => shopMessagesScreen(),
      'knowledge' => const KnowledgeScreen(),
      'members' => const MembersScreen(),
      'website_settings' => const WebsiteSettingsScreen(),
      'online_payments' => const OnlinePaymentsScreen(),
      'unanswered' => const UnansweredScreen(),
      'sources' => const SourcesScreen(),
      'reply_style' => const ReplyStyleScreen(),
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
      'chat' => ChatScreen(conversation: app.chatsOf('whatsapp').first),
      'chat_closed' => ChatScreen(conversation: app.chatsOf('whatsapp')[4]),
      'grow' => const GrowScreen(),
      'billing' => const BillingScreen(),
      'tickets' => const TicketsScreen(),
      'store' => const StoreScreen(),
      'new_order' => const NewOrderScreen(currency: 'INR'),
      'store_website' => const WebsiteScreen(),
      'chat_tickets' => const ChatTicketsScreen(),
      'store_products' => const StoreScreen(initialTab: 1),
      'store_flow' => const StoreScreen(initialTab: 2),
      'store_settings' => const StoreScreen(initialTab: 3),
      'store_tab' => const HomeShell(),
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
    // Free trial or plan ended: only "Choose a plan" until it is paid (the server refuses the rest anyway)
    if (!app.signedIn) return const LoginScreen();
    if (app.paused) return const PlanEndedScreen();
    // Just signed up: what the connectors give, then pick one (owners and admins; staff join a set-up workspace)
    if (app.needsOnboarding && app.can('settings')) return const OnboardingScreen();
    return const HomeShell();
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

  /// The tab by name, so switching a connector or Instagram on or off (which moves the tabs) keeps the same one.
  String? _tabId;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final unread = app.unreadIn('whatsapp');
    final ig = app.instagramOn;
    final igUnread = ig ? app.unreadIn('instagram') : 0;
    final desk = app.frontDeskOn;
    final store = !desk && app.storeOn;
    final requests = desk ? FrontDesk(app).requests.length : 0;
    final pages = [
      if (desk) ...[FrontDeskScreen(initialTab: widget.deskTab), const BillsScreen()],
      if (store) const StoreScreen(asTab: true),
      const ChatsScreen(),
      if (ig) const InstagramScreen(asTab: true),
      const MoreScreen(),
    ];
    final ids = [
      if (desk) ...['desk', 'bills'],
      if (store) 'store',
      'chats',
      if (ig) 'instagram',
      'more',
    ];
    _tabId ??= ids[_tab.clamp(0, ids.length - 1)];
    final tab = ids.contains(_tabId) ? ids.indexOf(_tabId!) : _tab.clamp(0, pages.length - 1);
    return Scaffold(
      body: IndexedStack(index: tab, children: pages),
      bottomNavigationBar: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Last days of the free trial: a thin bar to choose a plan
          const TrialBar(),
          Container(
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: Brand.line)),
            ),
            child: NavigationBar(
          selectedIndex: tab,
          onDestinationSelected: (i) => setState(() {
            _tab = i;
            _tabId = ids[i];
          }),
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
            if (store) const NavigationDestination(icon: Icon(Icons.storefront_outlined), selectedIcon: Icon(Icons.storefront), label: 'Store'),
            NavigationDestination(
              icon: app.whatsappOn
                  ? Badge(isLabelVisible: unread > 0, label: Text('$unread'), backgroundColor: Brand.green, child: const Icon(Icons.chat_bubble_outline))
                  : const Badge(label: Icon(Icons.lock, size: 10, color: Colors.white), backgroundColor: Brand.textSoft, child: Icon(Icons.chat_bubble_outline)),
              selectedIcon: app.whatsappOn
                  ? Badge(isLabelVisible: unread > 0, label: Text('$unread'), backgroundColor: Brand.green, child: const Icon(Icons.chat_bubble))
                  : const Badge(label: Icon(Icons.lock, size: 10, color: Colors.white), backgroundColor: Brand.textSoft, child: Icon(Icons.chat_bubble)),
              label: ig ? 'WhatsApp' : 'Chats',
            ),
            if (ig)
              NavigationDestination(
                icon: Badge(isLabelVisible: igUnread > 0, label: Text('$igUnread'), backgroundColor: Brand.green, child: const Icon(Icons.camera_alt_outlined)),
                selectedIcon: Badge(isLabelVisible: igUnread > 0, label: Text('$igUnread'), backgroundColor: Brand.green, child: const Icon(Icons.camera_alt)),
                label: 'Instagram',
              ),
            NavigationDestination(
              icon: Badge(isLabelVisible: app.syncWorthShowing, label: Text('${app.waitingCount}'), backgroundColor: app.failedCount > 0 ? Brand.red : Brand.navy, child: const Icon(Icons.more_horiz)),
              label: 'More',
            ),
          ],
        ),
          ),
        ],
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
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const AuthPicture('offline', aspect: 240 / 150, maxHeight: 150),
              const SizedBox(height: 20),
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
