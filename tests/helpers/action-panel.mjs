// Native extension side panels, like toolbar popups, are separate CDP targets.
export async function actionPanel(context, tab, worker, { open = true } = {}) {
  const cdp = await context.newCDPSession(tab);
  async function attach(targetId) {
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
    let sequence = 0;
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { cdp.off('Target.receivedMessageFromTarget', receive); reject(new Error(`Panel ${method} timed out`)); }, 10000);
      const receive = event => {
        if (event.sessionId !== sessionId) return;
        const response = JSON.parse(event.message); if (response.id !== id) return;
        clearTimeout(timer); cdp.off('Target.receivedMessageFromTarget', receive);
        response.error ? reject(new Error(response.error.message)) : resolve(response.result);
      };
      cdp.on('Target.receivedMessageFromTarget', receive);
      cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
    });
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    };
    return { send, evaluate };
  }
  // A real extension-page click supplies Chrome's user gesture; CDP evaluation
  // in a service worker does not. The bootstrap tab closes once the panel opens.
  if (open) {
  const launcher = await context.newPage();
  await launcher.goto(await worker.evaluate(() => chrome.runtime.getURL('src/popup.html')));
  const windowId = await launcher.evaluate(async () => (await chrome.windows.getCurrent()).id);
  await launcher.evaluate(windowId => {
    const button = document.createElement('button'); button.id = 'test-open-panel'; button.textContent = 'Open sidebar';
    button.style.cssText = 'position:fixed;inset:0;z-index:99999';
    button.onclick = () => { chrome.sidePanel.open({windowId}).then(() => { button.dataset.open = 'true'; }); };
    document.body.append(button);
  }, windowId);
  await launcher.locator('#test-open-panel').click();
  await launcher.waitForFunction(() => document.querySelector('#test-open-panel').dataset.open === 'true');
  await launcher.close();
  await tab.bringToFront();
  }
  const panelUrl = await worker.evaluate(() => chrome.runtime.getURL('src/library.html'));
  const deadline = Date.now() + 5000; let target;
  while (!target && Date.now() < deadline) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    target = targetInfos.find(item => item.url === panelUrl);
    if (!target) await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (!target) throw new Error('Chrome did not open the native side panel');
  const panel = await attach(target.targetId);
  const waitFor = async expression => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { if (await panel.evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 25)); }
    throw new Error(`Panel condition did not become true: ${expression}`);
  };
  return { ...panel, waitFor, close: () => cdp.send('Target.closeTarget', { targetId: target.targetId }) };
}
