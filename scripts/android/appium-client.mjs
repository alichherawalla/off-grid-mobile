/** Minimal Appium UiAutomator2 client for semantic React Native testID actions. */
export class AppiumAndroidClient {
  #baseUrl;
  #serial;
  #sessionId;

  constructor(baseUrl, serial) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#serial = serial;
  }

  async #request(path, method = 'GET', body) {
    const response = await fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json();
    if (!response.ok || payload.value?.error) {
      throw new Error(payload.value?.message ?? `Appium ${method} ${path} failed (${response.status})`);
    }
    return payload.value;
  }

  async session() {
    if (this.#sessionId) return this.#sessionId;
    const value = await this.#request('/session', 'POST', {
      capabilities: {
        alwaysMatch: {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:udid': this.#serial,
          'appium:deviceName': this.#serial,
          'appium:appPackage': 'ai.offgridmobile.dev',
          'appium:appActivity': 'ai.offgridmobile.MainActivity',
          'appium:noReset': true,
          'appium:dontStopAppOnReset': true,
          'appium:forceAppLaunch': false,
          'appium:newCommandTimeout': 600,
        },
      },
    });
    this.#sessionId = value.sessionId;
    return this.#sessionId;
  }

  async #find(using, value) {
    await this.session();
    const element = await this.#request(`/session/${this.#sessionId}/element`, 'POST', { using, value });
    return element['element-6066-11e4-a52e-4f735466cecf'] ?? element.ELEMENT;
  }

  async findByTestId(testId) {
    if (!/^[a-z0-9_./-]+$/i.test(testId)) throw new Error(`unsafe Android testID: ${testId}`);
    // React Native maps testID to Android resource-id. XPath keeps the match exact even when the id
    // has no package prefix, which is how this app's accessibility tree exposes it.
    return this.#find('xpath', `//*[@resource-id='${testId}']`);
  }

  async findUserMessageContaining(marker) {
    if (!/^[a-z0-9-]+$/i.test(marker)) throw new Error(`unsafe Android message marker: ${marker}`);
    return this.#find(
      'xpath',
      `//*[@resource-id='user-message'][.//*[@text and contains(@text,'${marker}')]]`,
    );
  }

  async source() {
    await this.session();
    return this.#request(`/session/${this.#sessionId}/source`);
  }

  async clickTestId(testId) {
    const elementId = await this.findByTestId(testId);
    await this.clickElement(elementId);
  }

  async clickElement(elementId) {
    await this.#request(`/session/${this.#sessionId}/element/${elementId}/click`, 'POST', {});
  }

  async describeElement(elementId) {
    const read = (suffix) =>
      this.#request(`/session/${this.#sessionId}/element/${elementId}/${suffix}`).catch(() => undefined);
    const [rect, displayed, enabled, resourceId, className, clickable] = await Promise.all([
      read('rect'),
      read('displayed'),
      read('enabled'),
      read('attribute/resource-id'),
      read('attribute/class'),
      read('attribute/clickable'),
    ]);
    return { elementId, resourceId, className, clickable, enabled, displayed, rect };
  }

  /**
   * A control located by XPath, for surfaces that carry no testID of ours.
   *
   * The system photo picker is another app: it has its own view tree and none of our handles, so a
   * journey that has to attach a real photo can only name what Android itself exposes.
   */
  async findByXPath(expression) {
    return this.#find('xpath', expression);
  }

  async clickByXPath(expression) {
    await this.clickElement(await this.findByXPath(expression));
  }

  /**
   * One attribute of a control, read from the device.
   *
   * A switch's truth is `checked`, not its label: `describeElement` reports geometry and identity,
   * and a toggle asked only what it is CALLED cannot be told on from off.
   */
  async attributeTestId(testId, name) {
    const elementId = await this.findByTestId(testId);
    return this.#request(
      `/session/${this.#sessionId}/element/${elementId}/attribute/${name}`,
    ).catch(() => undefined);
  }

  async replaceTestId(testId, text) {
    const elementId = await this.findByTestId(testId);
    await this.#request(`/session/${this.#sessionId}/element/${elementId}/click`, 'POST', {});
    await this.#request(`/session/${this.#sessionId}/element/${elementId}/clear`, 'POST', {});
    await this.#request(`/session/${this.#sessionId}/element/${elementId}/value`, 'POST', {
      text,
      value: [...text],
    });
  }

  async textTestId(testId) {
    const elementId = await this.findByTestId(testId);
    return this.#request(`/session/${this.#sessionId}/element/${elementId}/text`);
  }

  async hideKeyboard() {
    await this.session();
    await this.#request(`/session/${this.#sessionId}/appium/device/hide_keyboard`, 'POST', {}).catch(
      () => undefined,
    );
  }

  async close() {
    if (!this.#sessionId) return;
    const sessionId = this.#sessionId;
    this.#sessionId = undefined;
    await this.#request(`/session/${sessionId}`, 'DELETE').catch(() => undefined);
  }
}
