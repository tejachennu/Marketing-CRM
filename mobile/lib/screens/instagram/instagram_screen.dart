import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../config.dart';
import '../../data/app_state.dart';
import '../../data/backend.dart';
import '../../data/format.dart';
import '../../ui/skeleton.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../chats/chats_screen.dart';
import '../store/store_screen.dart' show confirmAction, fitPhoto, openLink, plain;

/// Instagram, as its own section (owner's rule: never mixed with WhatsApp chats). Like the web's Instagram menu:
/// Chats (DMs), Comments, Posts and Auto replies. Connecting the account is done once on the web (Facebook login).
class InstagramScreen extends StatefulWidget {
  const InstagramScreen({super.key, this.asTab = false, this.initialTab = 0});

  /// Shown as a bottom-bar tab (no back arrow).
  final bool asTab;
  final int initialTab;
  @override
  State<InstagramScreen> createState() => _InstagramScreenState();
}

class _InstagramScreenState extends State<InstagramScreen> {
  Map<String, dynamic>? _info;
  bool _loaded = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    // Trying again: the loading shapes, not the old error
    if (_error.isNotEmpty) {
      setState(() {
        _error = '';
        _loaded = false;
      });
    }
    try {
      final data = await app.backend.get('/api/instagram', {'organizationId': app.orgId});
      if (mounted) setState(() => _info = data);
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    }
    if (mounted) setState(() => _loaded = true);
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final account = _info?['account'] as Map?;
    final connected = account != null || (!_loaded && app.instagramOn) || (_info == null && app.instagramOn);
    final username = '${account?['username'] ?? app.instagramUsername}';
    final openComments = ((_info?['summary'] as Map?)?['openComments'] as num?)?.toInt() ?? 0;
    final unread = app.unreadIn('instagram');
    if (!connected) {
      return Scaffold(
        backgroundColor: Brand.page,
        appBar: AppBar(title: const Text('Instagram'), automaticallyImplyLeading: !widget.asTab),
        body: !_loaded
            ? const SkeletonCards()
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (_error.isNotEmpty)
                    EmptyState(
                      icon: Icons.cloud_off,
                      title: 'Could not check Instagram',
                      text: _error,
                      action: FilledButton(onPressed: _load, child: const Text('Try again')),
                    )
                  else
                    EmptyState(
                      icon: Icons.camera_alt_outlined,
                      title: 'Connect your Instagram',
                      text: 'Connect it once from WAMA CRM on the web (Settings → Instagram, with your Facebook login). Your Instagram messages, comments and posts then show here, apart from WhatsApp.',
                      action: FilledButton.icon(
                        onPressed: () => openLink(context, '${AppConfig.apiBase}/dashboard/settings?tab=instagram'),
                        icon: const Icon(Icons.open_in_new, size: 18),
                        label: const Text('Open settings on the web'),
                      ),
                    ),
                ],
              ),
      );
    }
    return DefaultTabController(
      length: 4,
      initialIndex: widget.initialTab.clamp(0, 3),
      child: Scaffold(
        backgroundColor: Colors.white,
        appBar: AppBar(
          automaticallyImplyLeading: !widget.asTab,
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Instagram'),
              if (username.isNotEmpty) Text('@$username', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w400, color: Brand.muted)),
            ],
          ),
          bottom: TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [
              Tab(text: unread > 0 ? 'Chats $unread' : 'Chats'),
              Tab(text: openComments > 0 ? 'Comments $openComments' : 'Comments'),
              const Tab(text: 'Posts'),
              const Tab(text: 'Auto replies'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            const _IgChats(),
            _IgComments(onChanged: _load),
            const _IgPosts(),
            _IgAutoReplies(
              saved: _info?['automation'] as Map?,
              error: _info == null ? _error : '',
              onRetry: _load,
              // Kept here too, so the tab shows what was saved when you come back to it
              onSaved: (automation) {
                if (mounted) setState(() => _info = {...?_info, 'automation': automation});
              },
            ),
          ],
        ),
      ),
    );
  }
}

// ── Chats (DMs) ──

class _IgChats extends StatefulWidget {
  const _IgChats();
  @override
  State<_IgChats> createState() => _IgChatsState();
}

class _IgChatsState extends State<_IgChats> {
  Timer? _timer;
  bool _messagesOff = false;
  int _waitMinutes = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _check());
    // Instagram does not always send new messages to us by itself: look every 2 minutes while this is open
    _timer = Timer.periodic(const Duration(minutes: 2), (_) => _check());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  /// Ask Instagram for new messages (the server does it at most once a minute), then reload the list.
  Future<void> _check() async {
    final app = AppScope.read(context);
    if (!app.online) return;
    try {
      final data = await app.backend.get('/api/instagram/messages', {'organizationId': app.orgId, 'sync': '1', 'list': '0'});
      if (mounted) {
        setState(() {
          _messagesOff = data['messagesOff'] == true;
          _waitMinutes = (data['waitMinutes'] as num?)?.toInt() ?? 0;
        });
      }
    } catch (_) {
      // The list below still shows what we have
    }
    await app.loadChats('instagram');
  }

  @override
  Widget build(BuildContext context) {
    Widget? banner;
    if (_messagesOff) {
      banner = const _Note(
        text: 'Instagram is not sharing your messages yet. In the Instagram app: Settings → Messages and story replies → Message controls → Connected tools → turn on "Allow access to messages".',
        attention: true,
      );
    } else if (_waitMinutes > 0) {
      banner = _Note(text: 'Instagram asked us to slow down. New messages will show in about $_waitMinutes min.');
    }
    return ChatList(channel: 'instagram', onRefresh: _check, banner: banner);
  }
}

class _Note extends StatelessWidget {
  const _Note({required this.text, this.attention = false});
  final String text;
  final bool attention;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(color: attention ? Brand.redSoft : Brand.lineSoft, borderRadius: BorderRadius.circular(10)),
    child: Text(text, style: TextStyle(fontSize: 13, height: 1.35, color: attention ? Brand.red : Brand.textSoft)),
  );
}

// ── Comments ──

class _IgComments extends StatefulWidget {
  const _IgComments({required this.onChanged});
  final VoidCallback onChanged;
  @override
  State<_IgComments> createState() => _IgCommentsState();
}

class _IgCommentsState extends State<_IgComments> {
  List<Map<String, dynamic>>? _comments;
  Map<String, Map> _posts = {};
  bool _all = false;
  String _error = '';
  String _busy = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load(sync: true));
  }

  Future<void> _load({bool sync = false}) async {
    final app = AppScope.read(context);
    try {
      final results = await Future.wait([
        app.backend.get('/api/instagram/comments', {'organizationId': app.orgId, 'filter': _all ? 'all' : 'open', if (sync) 'sync': '1'}),
        if (_posts.isEmpty) app.backend.get('/api/instagram/posts', {'organizationId': app.orgId}).catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _error = '';
        _comments = [for (final c in (results[0]['comments'] as List? ?? const [])) Map<String, dynamic>.from(c)];
        if (results.length > 1) _posts = {for (final p in (results[1]['posts'] as List? ?? const [])) '${p['id']}': p as Map};
      });
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    }
  }

  Future<void> _act(Map c, String action, {String text = ''}) async {
    final id = '${c['comment_id']}';
    setState(() => _busy = '$id:$action');
    try {
      await AppScope.read(context).ask('/api/instagram/comments', {'commentId': id, 'action': action, 'text': text});
      if (!mounted) return;
      toast(context, switch (action) {
        'reply' => 'Replied on Instagram.',
        'private' => 'Sent as a message. It is in Chats.',
        'hide' => 'Hidden. Only the person who wrote it still sees it.',
        'unhide' => 'Shown again.',
        _ => 'Deleted from Instagram.',
      });
      await _load();
      widget.onChanged();
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _reply(Map c, {required bool private}) async {
    final controller = TextEditingController();
    final text = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        // Scrolls when the keyboard leaves little room, so the button is never cut off
        child: SingleChildScrollView(
          child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(private ? 'Send @${c['from_username'] ?? 'them'} a message' : 'Reply to @${c['from_username'] ?? 'them'}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(
              private ? 'Goes to their Instagram inbox (once per comment, within 7 days).' : 'Everyone can see this reply under the post.',
              style: const TextStyle(color: Brand.muted, fontSize: 13),
            ),
            const SizedBox(height: 8),
            Text('"${c['text'] ?? ''}"', maxLines: 3, overflow: TextOverflow.ellipsis, style: const TextStyle(fontStyle: FontStyle.italic, color: Brand.textSoft)),
            const SizedBox(height: 12),
            TextField(controller: controller, autofocus: true, minLines: 2, maxLines: 5, maxLength: 1000, decoration: const InputDecoration(hintText: 'Write your reply')),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () {
                if (controller.text.trim().isEmpty) return toast(context, 'Write a reply first.');
                Navigator.pop(context, controller.text.trim());
              },
              child: Text(private ? 'Send message' : 'Reply'),
            ),
          ],
          ),
        ),
      ),
    );
    controller.dispose();
    if (text != null && text.isNotEmpty) await _act(c, private ? 'private' : 'reply', text: text);
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final list = _comments;
    return Column(
      children: [
        FilterChips(
          children: [
            ChoiceChip(label: const Text('Not answered'), selected: !_all, onSelected: (_) => setState(() { _all = false; _comments = null; _load(); })),
            ChoiceChip(label: const Text('All comments'), selected: _all, onSelected: (_) => setState(() { _all = true; _comments = null; _load(); })),
          ],
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => _load(sync: true),
            child: list == null
                ? (_error.isNotEmpty ? ListView(children: [EmptyState(icon: Icons.cloud_off, title: 'Could not load', text: _error)]) : const SkeletonList(rows: 5))
                : list.isEmpty
                ? ListView(
                    children: [
                      EmptyState(
                        icon: Icons.mode_comment_outlined,
                        title: _all ? 'No comments yet' : 'All answered',
                        text: _all ? 'Comments on your posts and reels show here.' : 'No comment is waiting for an answer.',
                      ),
                    ],
                  )
                : ListView.separated(
                    padding: const EdgeInsets.only(bottom: 24),
                    itemCount: list.length,
                    separatorBuilder: (_, _) => const Divider(height: 1, indent: 64),
                    itemBuilder: (context, i) {
                      final c = list[i];
                      final post = _posts['${c['media_id']}'];
                      final hidden = c['hidden'] == true;
                      final answered = c['replied_at'] != null || c['private_reply_at'] != null;
                      final busy = _busy.startsWith('${c['comment_id']}:');
                      return Padding(
                        padding: const EdgeInsets.fromLTRB(16, 12, 12, 8),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Avatar('${c['from_username'] ?? 'I'}', size: 38),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Flexible(child: Text('@${c['from_username'] ?? 'someone'}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700))),
                                      const SizedBox(width: 6),
                                      Text(formatWhen('${c['created_at'] ?? ''}'), style: const TextStyle(fontSize: 12, color: Brand.faint)),
                                      if (hidden) const Padding(padding: EdgeInsets.only(left: 6), child: Pill('Hidden', tone: PillTone.grey)),
                                    ],
                                  ),
                                  const SizedBox(height: 2),
                                  Text('${c['text'] ?? ''}', style: TextStyle(fontSize: 14.5, height: 1.3, color: hidden ? Brand.muted : Brand.text)),
                                  if (c['reply_text'] != null)
                                    Container(
                                      margin: const EdgeInsets.only(top: 6),
                                      padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
                                      decoration: BoxDecoration(color: Brand.lineSoft, borderRadius: BorderRadius.circular(8)),
                                      child: Text('${c['private_reply_at'] != null ? 'You sent a message' : 'You replied'}: ${c['reply_text']}', style: const TextStyle(fontSize: 13, color: Brand.textSoft)),
                                    ),
                                  if (app.can('write'))
                                    busy
                                        ? const Padding(padding: EdgeInsets.all(8), child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)))
                                        : Wrap(
                                            spacing: 0,
                                            children: [
                                              if (!answered || c['private_reply_at'] != null) TextButton(onPressed: () => _reply(c, private: false), child: const Text('Reply')),
                                              if (c['private_reply_at'] == null) TextButton(onPressed: () => _reply(c, private: true), child: const Text('Message them')),
                                              TextButton(onPressed: () => _act(c, hidden ? 'unhide' : 'hide'), child: Text(hidden ? 'Show' : 'Hide')),
                                              TextButton(
                                                onPressed: () async {
                                                  if (await confirmAction(context, title: 'Delete this comment?', message: 'It is removed from Instagram for everyone.', yes: 'Delete', destructive: true)) {
                                                    await _act(c, 'delete');
                                                  }
                                                },
                                                child: const Text('Delete', style: TextStyle(color: Brand.red)),
                                              ),
                                            ],
                                          ),
                                ],
                              ),
                            ),
                            if (post != null && '${post['image'] ?? ''}'.startsWith('https://'))
                              Padding(
                                padding: const EdgeInsets.only(left: 8),
                                child: InkWell(
                                  onTap: () => openLink(context, '${post['link']}'),
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(6),
                                    child: Image.network('${post['image']}', width: 44, height: 44, fit: BoxFit.cover, errorBuilder: (_, _, _) => const SizedBox(width: 44, height: 44)),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
        ),
      ],
    );
  }
}

// ── Posts ──

class _IgPosts extends StatefulWidget {
  const _IgPosts();
  @override
  State<_IgPosts> createState() => _IgPostsState();
}

class _IgPostsState extends State<_IgPosts> {
  List<Map<String, dynamic>>? _posts;
  String _error = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load({bool fresh = false}) async {
    final app = AppScope.read(context);
    try {
      final data = await app.backend.get('/api/instagram/posts', {'organizationId': app.orgId, if (fresh) 'fresh': '1'});
      if (mounted) setState(() => _posts = [for (final p in (data['posts'] as List? ?? const [])) Map<String, dynamic>.from(p)]);
    } catch (e) {
      if (mounted) setState(() => _error = plain(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final posts = _posts;
    return Scaffold(
      backgroundColor: Colors.white,
      floatingActionButton: app.can('manage')
          ? FloatingActionButton.extended(
              onPressed: () async {
                final done = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const NewIgPostScreen()));
                if (done == true) await _load(fresh: true);
              },
              icon: const Icon(Icons.add_a_photo_outlined),
              label: const Text('New post'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () => _load(fresh: true),
        child: posts == null
            ? (_error.isNotEmpty ? ListView(children: [EmptyState(icon: Icons.cloud_off, title: 'Could not load', text: _error)]) : const SkeletonCards())
            : posts.isEmpty
            ? ListView(children: const [EmptyState(icon: Icons.grid_on, title: 'No posts yet', text: 'Your Instagram posts show here. Tap New post to put one up from your phone.')])
            : GridView.builder(
                padding: const EdgeInsets.fromLTRB(2, 2, 2, 90),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, mainAxisSpacing: 2, crossAxisSpacing: 2),
                itemCount: posts.length,
                itemBuilder: (context, i) {
                  final p = posts[i];
                  final image = '${p['image'] ?? ''}';
                  return InkWell(
                    onTap: () => openLink(context, '${p['link']}'),
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        image.startsWith('https://')
                            ? Image.network(image, fit: BoxFit.cover, errorBuilder: (_, _, _) => Container(color: Brand.line))
                            : Container(color: Brand.line, alignment: Alignment.center, child: const Icon(Icons.image_outlined, color: Brand.faint)),
                        if (p['type'] == 'VIDEO' || p['type'] == 'CAROUSEL_ALBUM')
                          Positioned(
                            top: 6,
                            right: 6,
                            child: Icon(p['type'] == 'VIDEO' ? Icons.play_circle_fill : Icons.collections, color: Colors.white, size: 20, shadows: const [Shadow(blurRadius: 4)]),
                          ),
                      ],
                    ),
                  );
                },
              ),
      ),
    );
  }
}

/// Put a post on Instagram from the phone: up to 10 photos (one post or a carousel) and a caption.
class NewIgPostScreen extends StatefulWidget {
  const NewIgPostScreen({super.key});
  @override
  State<NewIgPostScreen> createState() => _NewIgPostScreenState();
}

class _NewIgPostScreenState extends State<NewIgPostScreen> {
  final _caption = TextEditingController();
  final List<String> _photos = [];
  bool _uploading = false;
  bool _posting = false;
  bool _posted = false;

  /// Kept from the start: the screen can no longer look it up while it closes.
  AppState? _app;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _app = AppScope.read(context);
  }

  @override
  void dispose() {
    // Photos uploaded but not posted are removed from our storage
    final app = _app;
    if (!_posted && _photos.isNotEmpty && app != null) {
      app.backend.send('DELETE', '/api/instagram/photos', {'organizationId': app.orgId, 'urls': [..._photos]}).catchError((_) => <String, dynamic>{});
    }
    _caption.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    final app = AppScope.read(context);
    final picked = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'heic']);
    if (picked.isEmpty) return;
    setState(() => _uploading = true);
    try {
      for (final f in picked.take(10 - _photos.length)) {
        // The size first, before reading it (a huge file would not fit in the phone's memory)
        final size = f.lengthSync() ?? await f.length() ?? 0;
        if (size > 30 * 1024 * 1024) throw Exception('${f.name} is too big. Pick a photo under 4 MB.');
        // One upload from the app can carry about 4 MB: a bigger phone photo is made smaller first
        final (bytes, name) = await fitPhoto(await f.readAsBytes(), f.name);
        final saved = await app.uploadFile(bytes, name, path: '/api/instagram/photos', fields: {'organizationId': app.orgId});
        if (mounted) setState(() => _photos.add('${saved['url']}'));
      }
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _post() async {
    if (_photos.isEmpty) return toast(context, 'Add at least one photo.');
    setState(() => _posting = true);
    try {
      await AppScope.read(context).ask('/api/instagram/posts', {'images': _photos, 'caption': _caption.text.trim()});
      _posted = true;
      if (!mounted) return;
      toast(context, 'Posted on Instagram.');
      Navigator.pop(context, true);
    } on SlowServerException {
      // Instagram is still putting it up: keep the photos (they are being used), and do not offer to post it again
      _posted = true;
      if (!mounted) return;
      toast(context, 'Still posting. Check Posts in a minute before trying again.');
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _posting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Brand.page,
      appBar: AppBar(title: const Text('New Instagram post')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Photos (${_photos.length}/10)', style: const TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                const Text('One photo makes a post; more make a carousel people swipe through.', style: TextStyle(fontSize: 13, color: Brand.muted)),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final url in _photos)
                      Stack(
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: Image.network(url, width: 84, height: 84, fit: BoxFit.cover, errorBuilder: (_, _, _) => Container(width: 84, height: 84, color: Brand.line)),
                          ),
                          Positioned(
                            top: 2,
                            right: 2,
                            child: InkWell(
                              onTap: () => setState(() => _photos.remove(url)),
                              child: Container(
                                decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                                padding: const EdgeInsets.all(2),
                                child: const Icon(Icons.close, size: 16, color: Colors.white),
                              ),
                            ),
                          ),
                        ],
                      ),
                    if (_photos.length < 10)
                      InkWell(
                        onTap: _uploading ? null : _add,
                        borderRadius: BorderRadius.circular(8),
                        child: Container(
                          width: 84,
                          height: 84,
                          decoration: BoxDecoration(borderRadius: BorderRadius.circular(8), border: Border.all(color: Brand.border)),
                          alignment: Alignment.center,
                          child: _uploading ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.add_a_photo_outlined, color: Brand.muted),
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Panel(
            child: TextField(
              controller: _caption,
              minLines: 4,
              maxLines: 10,
              maxLength: 2200,
              decoration: const InputDecoration(labelText: 'Caption', hintText: 'Say what it is, the price, and how to order. #hashtags work too.', alignLabelWithHint: true),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _posting || _uploading ? null : _post,
            icon: _posting ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send),
            label: Text(_posting ? 'Posting… (up to a minute)' : 'Post on Instagram'),
          ),
        ],
      ),
    );
  }
}

// ── Auto replies ──

class _IgAutoReplies extends StatefulWidget {
  const _IgAutoReplies({required this.saved, this.error = '', this.onRetry, this.onSaved});
  final Map? saved;

  /// Why the settings could not be loaded (empty while loading or loaded).
  final String error;
  final VoidCallback? onRetry;
  final ValueChanged<Map<String, dynamic>>? onSaved;
  @override
  State<_IgAutoReplies> createState() => _IgAutoRepliesState();
}

class _IgAutoRepliesState extends State<_IgAutoReplies> {
  Map<String, dynamic>? _a;
  final _everyReply = TextEditingController();
  final _everyDm = TextEditingController();
  final _hide = TextEditingController();
  bool _saving = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _take();
  }

  @override
  void didUpdateWidget(covariant _IgAutoReplies old) {
    super.didUpdateWidget(old);
    if (old.saved != widget.saved) _take();
  }

  void _take() {
    if (_a != null || widget.saved == null) return;
    final a = Map<String, dynamic>.from(widget.saved!);
    final every = Map<String, dynamic>.from(a['everyComment'] as Map? ?? const {});
    _a = {
      'dmAi': a['dmAi'] != false,
      'commentAi': a['commentAi'] == true,
      'rules': [for (final r in (a['rules'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)],
      'everyOn': every['on'] == true,
    };
    _everyReply.text = '${every['reply'] ?? ''}';
    _everyDm.text = '${every['dm'] ?? ''}';
    _hide.text = (a['hideWords'] as List? ?? const []).join(', ');
  }

  @override
  void dispose() {
    _everyReply.dispose();
    _everyDm.dispose();
    _hide.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final a = _a!;
    setState(() => _saving = true);
    final automation = <String, dynamic>{
      'dmAi': a['dmAi'],
      'commentAi': a['commentAi'],
      'rules': [for (final r in a['rules'] as List) Map<String, dynamic>.from(r as Map)],
      'everyComment': {'on': a['everyOn'], 'reply': _everyReply.text.trim(), 'dm': _everyDm.text.trim()},
      'hideWords': _hide.text.split(',').map((w) => w.trim()).where((w) => w.isNotEmpty).toList(),
    };
    try {
      await AppScope.read(context).ask('/api/instagram', {'automation': automation}, method: 'PUT');
      widget.onSaved?.call(automation);
      if (mounted) toast(context, 'Auto replies saved.');
    } catch (e) {
      if (mounted) toast(context, plain(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _editRule([int? index]) async {
    final rules = _a!['rules'] as List;
    final rule = index == null ? <String, dynamic>{} : Map<String, dynamic>.from(rules[index] as Map);
    final words = TextEditingController(text: (rule['keywords'] as List? ?? const []).join(', '));
    final reply = TextEditingController(text: '${rule['reply'] ?? ''}');
    final dm = TextEditingController(text: '${rule['dm'] ?? ''}');
    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(index == null ? 'New keyword reply' : 'Keyword reply', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              TextField(controller: words, decoration: const InputDecoration(labelText: 'When a comment has any of these words', hintText: 'price, cost, how much')),
              const SizedBox(height: 10),
              TextField(controller: reply, minLines: 2, maxLines: 4, maxLength: 900, decoration: const InputDecoration(labelText: 'Public reply (optional)', hintText: 'Sent you the details in a message, {name}!')),
              TextField(controller: dm, minLines: 2, maxLines: 4, maxLength: 900, decoration: const InputDecoration(labelText: 'Message to them (optional)', hintText: 'Hi {name}, the price is …')),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: () {
                  final kws = words.text.split(',').map((w) => w.trim().toLowerCase()).where((w) => w.isNotEmpty).toList();
                  if (kws.isEmpty) return toast(context, 'Type at least one word.');
                  if (reply.text.trim().isEmpty && dm.text.trim().isEmpty) return toast(context, 'Write a public reply, a message, or both.');
                  Navigator.pop(context, {'keywords': kws, 'reply': reply.text.trim(), 'dm': dm.text.trim()});
                },
                child: const Text('Done'),
              ),
            ],
          ),
        ),
      ),
    );
    words.dispose();
    reply.dispose();
    dm.dispose();
    if (result == null) return;
    setState(() {
      if (index == null) {
        rules.add(result);
      } else {
        rules[index] = result;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final a = _a;
    if (a == null) {
      if (widget.error.isEmpty) return const SkeletonCards();
      return ListView(
        children: [
          EmptyState(
            icon: Icons.cloud_off,
            title: 'Could not load auto replies',
            text: widget.error,
            action: widget.onRetry == null ? null : FilledButton(onPressed: widget.onRetry, child: const Text('Try again')),
          ),
        ],
      );
    }
    final manage = app.can('manage');
    final rules = a['rules'] as List;
    Widget toggle(String key, String title, String subtitle) => SwitchListTile(
      contentPadding: EdgeInsets.zero,
      value: a[key] == true,
      onChanged: manage ? (v) => setState(() => a[key] = v) : null,
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(subtitle),
    );
    return Container(
      color: Brand.page,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
        children: [
          Panel(
            child: Column(
              children: [
                toggle('dmAi', 'AI answers messages', 'From your knowledge base. You can turn it off in one chat.'),
                const Divider(height: 1),
                toggle('commentAi', 'AI answers comments', 'A short public reply when the knowledge base has the answer.'),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const SectionLabel('Keyword replies'),
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (rules.isEmpty) const Text('When a comment has a word you choose (like "price"), reply in public and/or send them a message.', style: TextStyle(color: Brand.muted)),
                for (var i = 0; i < rules.length; i++)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text((rules[i]['keywords'] as List).join(', '), style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text([if ('${rules[i]['reply']}'.isNotEmpty) 'Reply: ${rules[i]['reply']}', if ('${rules[i]['dm']}'.isNotEmpty) 'Message: ${rules[i]['dm']}'].join('\n'), maxLines: 3, overflow: TextOverflow.ellipsis),
                    onTap: manage ? () => _editRule(i) : null,
                    trailing: manage ? IconButton(tooltip: 'Remove', onPressed: () => setState(() => rules.removeAt(i)), icon: const Icon(Icons.delete_outline, color: Brand.muted)) : null,
                  ),
                if (manage && rules.length < 20) Align(alignment: Alignment.centerLeft, child: TextButton.icon(onPressed: () => _editRule(), icon: const Icon(Icons.add), label: const Text('Add a keyword reply'))),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const SectionLabel('Every other comment'),
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                toggle('everyOn', 'Reply to every other comment', 'Used when no keyword matches.'),
                if (a['everyOn'] == true) ...[
                  TextField(controller: _everyReply, enabled: manage, maxLength: 900, decoration: const InputDecoration(labelText: 'Public reply', hintText: 'Thank you {name}! 💛')),
                  TextField(controller: _everyDm, enabled: manage, maxLength: 900, decoration: const InputDecoration(labelText: 'Message to them (optional)')),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),
          const SectionLabel('Hide comments with these words'),
          Panel(
            child: TextField(controller: _hide, enabled: manage, decoration: const InputDecoration(hintText: 'spam, abuse words…', helperText: 'Separate words with commas. Hidden comments stay visible only to the person who wrote them.', helperMaxLines: 2)),
          ),
          const SizedBox(height: 16),
          if (manage)
            FilledButton(onPressed: _saving ? null : _save, child: Text(_saving ? 'Saving…' : 'Save auto replies'))
          else
            const Text('Only managers change auto replies.', textAlign: TextAlign.center, style: TextStyle(color: Brand.muted)),
        ],
      ),
    );
  }
}
