declare global {
  interface Window {
    mockNotifications: Array<{ title: string; body?: string }>;
  }
}

import { test, expect } from '@jupyterlab/galata';
import { Page } from '@playwright/test';

async function setupNotificationMock(page:Page): Promise<void> {
  await page.evaluate(() => {
    window.mockNotifications = [];

    // Mock the Notification constructor
    const MockNotification = function (title: string, options?: NotificationOptions) {
      window.mockNotifications.push({ title, body: options?.body });
    } as any;

    window.Notification = MockNotification;

    // Override the read-only 'permission' property
    Object.defineProperty(window.Notification, 'permission', {
      value: 'granted',
      writable: true,
      configurable: true
    });

    // Mock requestPermission
    window.Notification.requestPermission = async () => 'granted';
  });
}

test('Toggle notification mode updates icon and metadata', async ({ page }) => {
  // Open a new notebook
  await page.notebook.createNew('test.ipynb');
  
  // Select the first cell
  await page.notebook.selectCells(0);
  
  // Find the notify toolbar button
  const toolbarButton = await page.locator('[data-command="toggle-cell-notifications"]');
  expect(await toolbarButton.isVisible()).toBe(true);

  // To verify cell-metadata
  await page.sidebar.close()
  await page.menu.clickMenuItem('View>Appearance>Show Right Sidebar')
  await page.locator('.jp-Collapse-header:has-text("ADVANCED TOOLS")').click()
  const metadata = page.locator('.jp-JSONEditor-host').first()

  // Check initial icon and metadata (default mode: 'never')
  let icon = await toolbarButton.locator('svg').getAttribute('data-icon');
  expect(icon).toBe('notify:bell-off'); // bellOffIcon
  await expect(metadata).toContainText('\"mode\": \"never\"')
  
  // Toggle to 'always'
  await toolbarButton.click();
  icon = await toolbarButton.locator('svg').getAttribute('data-icon');
  expect(icon).toBe('notify:bell-filled'); // bellFilledIcon
  await expect(metadata).toContainText('\"mode\": \"always\"')


  // Toggle to 'on-error'
  await toolbarButton.click();
  icon = await toolbarButton.locator('svg').getAttribute('data-icon');
  expect(icon).toBe('notify:bell-alert'); // bellAlertIcon
  await expect(metadata).toContainText('\"mode\": \"on-error\"')

  // Toggle to 'global-timeout'
  await toolbarButton.click();
  icon = await toolbarButton.locator('svg').getAttribute('data-icon');
  expect(icon).toBe('notify:bell-clock'); // bellClockIcon
  await expect(metadata).toContainText('\"mode\": \"global-timeout\"')

  // Toggle to 'custom-timeout'
  await toolbarButton.click();
  icon = await toolbarButton.locator('svg').getAttribute('data-icon');
  expect(icon).toBe('notify:bell-outline'); // bellClockIcon
  await expect(metadata).toContainText('\"mode\": \"custom-timeout\"')
});


test('Notification triggers on cell execution with "always" mode', async ({ page, browser }) => {
  // To Capture notifications in MockNotifications array
  await setupNotificationMock(page)

  // Create a new notebook
  await page.notebook.createNew('test.ipynb');

  // Locate the toolbar button for toggling notifications
  const toolbarButton = await page.locator('[data-command="toggle-cell-notifications"]');
  expect(await toolbarButton.isVisible()).toBe(true);

  // Select the first cell
  await page.notebook.selectCells(0);

  // Toggle to 'always'
  await toolbarButton.click();

  // Execute a successful cell
  await page.notebook.enterCellEditingMode(0)
  await page.keyboard.type('print("Hello")');
  await page.notebook.runCell(0);

  // Verify success notification
  const successNotifications = await page.evaluate(() => {
    return window.mockNotifications;
  });;
  expect(successNotifications.length).toBeGreaterThan(0);
  expect(successNotifications[0].title).toContain('Cell execution completed successfully');

  // Execute a failing cell
  await page.notebook.selectCells(1);

  // Toggle to 'always'
  await toolbarButton.click();
  await page.notebook.enterCellEditingMode(1);
  await page.keyboard.type('raise Exception("Error")');
  await page.notebook.runCell(1);

  // Verify error notification
  const allNotifications = await page.evaluate(() => {
    return window.mockNotifications;
  });
  expect(allNotifications.length).toBeGreaterThan(1);
  expect(allNotifications[1].title).toContain('Cell execution failed');
});


test('Notification triggers only on error with "on-error" mode', async ({ page }) => {
  await setupNotificationMock(page);

  // Create a new notebook
  await page.notebook.createNew('test.ipynb');

  // Locate the toolbar button for toggling notifications
  const toolbarButton = await page.locator('[data-command="toggle-cell-notifications"]');
  expect(await toolbarButton.isVisible()).toBe(true);

  // Select the first cell
  await page.notebook.selectCells(0);

  // Toggle to 'on-error'
  await toolbarButton.click(); // To 'always'
  await toolbarButton.click(); // To 'on-error'

  // Execute a successful cell
  await page.notebook.enterCellEditingMode(0);
  await page.keyboard.type('print("Hello")');
  await page.notebook.runCell(0);

  // No notification expected for success
  const successNotifications = await page.evaluate(() => window.mockNotifications);
  expect(successNotifications.length).toBe(0);

  // Execute a failing cell
  await page.notebook.enterCellEditingMode(0);
  await page.keyboard.type('raise Exception("Error")');
  await page.notebook.runCell(0);

  // Verify error notification
  const errorNotifications = await page.evaluate(() => window.mockNotifications);
  expect(errorNotifications.length).toBe(1);
  expect(errorNotifications[0].title).toContain('Cell execution failed');
});

// To do: early notifications ?
test('Notification triggers only on timeout with "global-timeout" mode', async ({ page }) => {

  // Set global timeout threshold to 1 second
  await page.evaluate(async () => {
    await window.jupyterapp.serviceManager.settings.save(
      'jupyterlab-notify:plugin',
      JSON.stringify({threshold: 1})
    );
  });
  
  // Reload so that new threshold is applied
  await page.reload()
  await setupNotificationMock(page);

  await page.notebook.createNew('test.ipynb');
  const toolbarButton = page.locator('[data-command="toggle-cell-notifications"]');
  await page.notebook.selectCells(0);

  // Toggle to 'global-timeout'
  await toolbarButton.click(); // To 'always'
  await toolbarButton.click(); // To 'on-error'
  await toolbarButton.click(); // To 'global-timeout'

  // Execute a long-running cell (2 seconds)
  await page.notebook.enterCellEditingMode(0);
  await page.keyboard.type('import time; time.sleep(2)');
  await page.notebook.runCell(0);

  // Verify timeout notification
  const notifications = await page.evaluate(() => window.mockNotifications);
  expect(notifications.length).toBeGreaterThan(0);
  expect(notifications[0].title).toContain('Cell execution timeout reached');
});

test('Displays warning when email is enabled but not configured', async ({ page }) => {
  // Enable email in settings
  await page.evaluate(async () => {
    await window.jupyterapp.serviceManager.settings.save(
      'jupyterlab-notify:plugin',
      JSON.stringify({mail: true})
    );
  });
  
  // Reload so that new setting is applied
  await page.reload()

  // Execute a cell with 'always' mode
  await page.notebook.createNew('test.ipynb');
  const toolbarButton = page.locator('[data-command="toggle-cell-notifications"]');
  await page.notebook.selectCells(0);
  await toolbarButton.click(); // To 'always'
  await page.notebook.runCell(0)

  // Note: This test assumes that email configuration is not set up in the CI environment.
  // It may fail if run locally where email is configured.
  const warning = await page.waitForSelector('.jp-toast-message', { timeout: 2000 });
  const text = await warning.textContent();
  expect(text).toContain('Email Not Configured');
});
