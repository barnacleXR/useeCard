"""隔离实例的真实浏览器管理回归；USEECARD_BROWSER_URL 指向测试服务。"""
import os
import base64
import hashlib
import urllib.parse
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('USEECARD_BROWSER_URL', 'http://127.0.0.1:3098')

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 430, "height": 900})
    page.add_init_script("""
      if ('PushManager' in window) {
        PushManager.prototype.subscribe = async function () { return {toJSON: () => ({endpoint:'https://1.1.1.1/browser-regression',keys:{p256dh:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',auth:'bbbbbbbbbbbbbbbbbbbb'}})}; };
        PushManager.prototype.getSubscription = async function () { return {unsubscribe: async () => true}; };
      }
      if ('Notification' in window) Notification.requestPermission = async () => 'granted';
    """)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL)
    page.wait_for_load_state('networkidle')
    if page.get_by_role('button', name='初始化实例').count():
        page.get_by_label('用户名').fill('owner')
        page.get_by_label('密码').fill('a-good-password-123')
        page.get_by_role('button', name='初始化实例').click()
    else:
        page.get_by_label('用户名').fill('owner')
        page.get_by_label('密码').fill('a-good-password-123')
        page.get_by_role('button', name='登录', exact=True).click()
    expect(page.get_by_role('button', name='退出')).to_be_visible()
    manifest = page.request.get(URL + '/manifest.webmanifest').json()
    assert {'192x192', '512x512'} <= {item['sizes'] for item in manifest['icons']}
    assert page.evaluate('navigator.serviceWorker.ready.then(() => true)')
    cached = page.evaluate('caches.keys().then(keys => Promise.all(keys.map(key => caches.open(key).then(cache => cache.keys())))).then(groups => groups.flat().map(request => new URL(request.url).pathname))')
    assert not any(path.startswith('/api/') for path in cached), cached
    session = page.request.get(URL + '/api/auth/session').json()
    headers = {'Content-Type': 'application/json', 'X-CSRF-Token': session['csrf']}
    long_name = '楽天カード・' + '長い日本語カード名' * 8
    account = page.request.post(URL + '/api/accounts', data={'name': '三井住友銀行・' + '長い日本語口座名' * 7}, headers=headers)
    assert account.status == 201, account.text()
    card = page.request.post(URL + '/api/cards', data={'name': long_name, 'defaultDebitAccountId': account.json()['id'], 'defaultCurrency': 'JPY'}, headers=headers)
    assert card.status == 201, card.text()
    page.goto(URL + '/bills')
    page.wait_for_load_state('networkidle')
    page.get_by_role('combobox', name='信用卡').first.click()
    expect(page.get_by_role('option', name=long_name).first).to_be_visible()
    page.get_by_role('option', name=long_name).first.click()
    page.get_by_role('button', name='＋ 录入账单').click()
    expect(page.get_by_role('dialog')).to_be_visible()
    page.get_by_role('dialog').get_by_role('combobox', name='信用卡').click()
    expect(page.get_by_role('option', name=long_name).first).to_be_visible()
    page.keyboard.press('Escape')
    page.get_by_role('dialog').get_by_role('button', name='关闭').click()
    page.goto(URL + '/settings')
    page.wait_for_load_state('networkidle')
    # 真正打开 Vean 下拉框，键盘选择后检查弹层关闭。
    page.get_by_role('combobox', name='新建卡片默认币种').click()
    expect(page.get_by_role('option', name='USD')).to_be_visible()
    page.keyboard.press('Escape')
    currency = page.get_by_role('combobox', name='新建卡片默认币种')
    currency.click()
    page.keyboard.press('ArrowDown')
    assert page.evaluate('document.activeElement?.getAttribute("role")') == 'option'
    page.keyboard.press('Enter')
    expect(currency).to_have_attribute('aria-expanded', 'false')
    page.get_by_role('button', name='通知', exact=True).last.click()
    expect(page.get_by_text('扣款提醒')).to_be_visible()
    page.get_by_role('button', name='安装与离线').click()
    reason = page.get_by_text('部署环境未配置 VAPID 密钥')
    subscribe_button = page.get_by_role('button', name='订阅此设备')
    reason.or_(subscribe_button).first.wait_for()
    if reason.count():
        assert page.get_by_role('button', name='订阅此设备').count() == 0
    else:
        subscribe_button.click()
        expect(page.get_by_role('button', name='取消')).to_be_visible()
        page.get_by_role('button', name='取消').click()
    databases = page.evaluate('indexedDB.databases().then(items => items.map(item => item.name))')
    assert 'useecard-offline' not in databases, databases
    # 明确同意后才能保存含金额与扣款日的本机快照。
    page.once('dialog', lambda dialog: dialog.accept())
    page.get_by_role('button', name='同意并保存快照').click()
    expect(page.get_by_role('button', name='删除快照')).to_be_visible()
    page.context.set_offline(True)
    page.reload(wait_until='domcontentloaded')
    expect(page.get_by_role('button', name='查看本机离线快照')).to_be_visible()
    page.get_by_role('button', name='查看本机离线快照').click()
    expect(page.get_by_text('离线账单快照')).to_be_visible()
    page.context.set_offline(False)
    page.goto(URL + '/settings')
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='安装与离线').click()
    page.get_by_role('button', name='删除快照').click()
    expect(page.get_by_role('button', name='同意并保存快照')).to_be_visible()
    page.goto(URL + '/backups')
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='从备份恢复').click()
    expect(page.get_by_role('dialog')).to_be_visible()
    page.get_by_role('button', name='关闭').click()
    page.get_by_role('combobox', name='自动备份').click()
    expect(page.get_by_role('option', name='每天')).to_be_visible()
    page.keyboard.press('Escape')
    page.goto(URL + '/profile')
    page.wait_for_load_state('networkidle')
    page.get_by_label('显示名称').fill('管理员')
    page.get_by_role('button', name='保存资料').click()
    expect(page.get_by_text('资料已保存')).to_be_visible()
    page.goto(URL + '/system')
    page.wait_for_load_state('networkidle')
    expect(page.get_by_text('磁盘使用', exact=True)).to_be_visible()
    page.goto(URL + '/audit')
    page.wait_for_load_state('networkidle')
    page.get_by_role('combobox', name='来源').click()
    expect(page.get_by_role('option', name='Web')).to_be_visible()
    page.keyboard.press('Escape')
    # 动态注册客户端后，在真实授权页检查默认只读、写入警告和批准跳转。
    registered = page.request.post(URL + '/register', data={
        'client_name': '浏览器回归', 'redirect_uris': ['http://127.0.0.1:9999/callback']
    }, headers={'Content-Type': 'application/json'})
    assert registered.status == 201, registered.text()
    client_id = registered.json()['client_id']
    verifier = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b'=').decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    params = urllib.parse.urlencode({'response_type': 'code', 'client_id': client_id,
        'redirect_uri': 'http://127.0.0.1:9999/callback', 'code_challenge': challenge,
        'code_challenge_method': 'S256', 'scope': 'bills:read bills:write', 'resource': URL + '/mcp'})
    page.goto(URL + '/authorize?' + params)
    page.wait_for_load_state('networkidle')
    expect(page.get_by_text('允许「浏览器回归」访问 useeCard？')).to_be_visible()
    write_scope = page.locator('fieldset').nth(1).locator('input[type="checkbox"]').first
    assert not write_scope.is_checked()
    write_scope.check()
    expect(page.get_by_text('已勾选写入权限', exact=False)).to_be_visible()
    write_scope.uncheck()
    page.route('http://127.0.0.1:9999/**', lambda route: route.fulfill(status=200, body='callback received'))
    page.get_by_role('button', name='授权', exact=True).click()
    expect(page.get_by_text('callback received')).to_be_visible()
    assert urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query).get('code')
    # 桌面及三种窄屏均可访问设置、备份和状态，不产生横向溢出。
    for width in (1280, 320, 375, 430):
        page.set_viewport_size({"width": width, "height": 900})
        for route in ('/settings', '/backups', '/system', '/bills'):
            page.goto(URL + route)
            page.wait_for_load_state('networkidle')
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2'), (width, route)
    page.goto(URL + '/settings')
    page.get_by_role('button', name='安装与离线').click()
    page.once('dialog', lambda dialog: dialog.accept())
    page.get_by_role('button', name='同意并保存快照').click()
    expect(page.get_by_role('button', name='删除快照')).to_be_visible()
    page.get_by_role('button', name='退出').click()
    expect(page.get_by_role('button', name='登录', exact=True)).to_be_visible()
    page.wait_for_function("() => indexedDB.databases().then(items => !items.some(item => item.name === 'useecard-offline'))")
    assert not errors, errors
    browser.close()
