# jupyterlab-notify

[![PyPI version][pypi-image]][pypi-url] [![PyPI DM][pypi-dm-image]][pypi-url]
[![Github Actions Status][github-status-image]][github-status-url] [![Binder][binder-image]][binder-url]

JupyterLab extension to notify cell completion

![notify-extension-in-action](https://github.com/deshaw/jupyterlab-notify/blob/main/docs/notify-screenshot.png?raw=true)

## Usage

The `jupyterlab-notify` extension allows you to receive notifications about cell execution results in JupyterLab. Notifications are configured through cell metadata or the JupyterLab interface, providing seamless integration and easier management of notification preferences. Notifications can be sent via desktop pop-ups, Slack messages, or emails, depending on your configuration.

**Important Note**: JupyterLab Notify v2 supports `jupyter-server-nbmodel`(>= v0.1.1a2), enabling notifications to work even after the browser is closed. To enable browser-less notification support, install it with:
```bash
pip install jupyter-server-nbmodel
```

### Configuration

To enable Slack and email notifications, create a configuration file at `~/.jupyter/jupyterlab_notify_config.json` with the following format:

```json
{
  "slack_token": "xoxb-1234567890123-1234567890123-abcDEFghiJKLmnOPqrstUVwx",
  "slack_channel_name": "notifications",
  "email": "user@example.com"
}
```

- `slack_token`: A valid Slack bot token with `chat:write` permissions. Refer ![this article](https://help.thebotplatform.com/en/articles/7233667-how-to-create-a-slack-bot) to create your own slack bot
- `slack_channel_name`: The Slack channel to post notifications to.
- `email`: The email address to receive notifications. Refer ![this article](https://mailtrap.io/blog/setup-smtp-server/) to setup SMTP server.

**Note:** Ensure your JupyterLab server has SMTP access for email notifications (configured separately).

### Notification Modes

You can control when notifications are sent by setting a mode for each cell. Modes can be configured through the JupyterLab interface by clicking on the bell icon in the cell toolbar.

![image](https://github.com/user-attachments/assets/b384c0ee-88d0-47e8-9825-e42becf657a7)

**Supported modes include:**

- `always`: Sends a notification every time a cell finishes executing.
- `never`: Disables notifications for the cell.
- `on-error`: Sends a notification only if the cell - execution fails with an error.
- `global-timeout`: Sends a notification if the cell execution exceeds a globally configured timeout.
- `custom-timeout`: Sends a notification if the cell execution exceeds a timeout specified for that cell.

### Global And Custom Timeout

Configure the global and custom timeout value in JupyterLab’s settings:

1. Go to Settings Editor.
2. Select notify.
3. Set "globalTimeout": 30 (in seconds) to apply to cells using the global-timeout mode.

### Desktop Notifications

Desktop notifications are enabled by default and appear as pop-up alerts on your system.

![image](https://github.com/user-attachments/assets/77bb746d-2f00-4473-8a5e-28cb4ecba115)

### Slack Notifications

Slack notifications are sent to the configured channel, requiring the setup described in the Configuration section.

### Email Notifications

Email notifications are sent to the configured email address, also requiring the setup from the Configuration section.

#### Configuration warning

If your email or Slack notifications are not configured but you attempt to enable them through the settings editor, a warning will be displayed when you try to execute a cell in the JupyterLab interface.

![image](https://github.com/user-attachments/assets/d7ae64f0-e409-44db-a3a9-f657882da532)


## Troubleshoot

If you notice that the desktop notifications are not showing up, check the below:

1. Make sure JupyterLab is running in a secure context (i.e. either using HTTPS or localhost)
2. If you've previously denied notification permissions for the site, update the browser settings accordingly. In Chrome, you can do so by navigating to `Setttings -> Privacy and security -> Site Settings -> Notifications` and updating the permissions against your JupyterLab URL.
3. Verify that notifications work for your browser. You may need to configure an OS setting first. You can test on [this site](https://web-push-book.gauntface.com/demos/notification-examples/).

## Requirements

- JupyterLab >= 4.0

## Install

To install this package with [`pip`](https://pip.pypa.io/en/stable/) run

```bash
pip install jupyterlab_notify
```

## Contributing

### Development install

Note: You will need NodeJS to build the extension package.

The `jlpm` command is JupyterLab's pinned version of
[yarn](https://yarnpkg.com/) that is installed with JupyterLab. You may use
`yarn` or `npm` in lieu of `jlpm` below.

```bash
# Clone the repo to your local environment
# Change directory to the jupyterlab_notify directory
# Install package in development mode
pip install -e .
# Link your development version of the extension with JupyterLab
jupyter-labextension develop . --overwrite
# Rebuild extension Typescript source after making changes
jlpm run build
```

You can watch the source directory and run JupyterLab at the same time in different terminals to watch for changes in the extension's source and automatically rebuild the extension.

```bash
# Watch the source directory in one terminal, automatically rebuilding when needed
jlpm run watch
# Run JupyterLab in another terminal
jupyter lab
```

With the watch command running, every saved change will immediately be built locally and available in your running JupyterLab. Refresh JupyterLab to load the change in your browser (you may need to wait several seconds for the extension to be rebuilt).

By default, the `jlpm run build` command generates the source maps for this extension to make it easier to debug using the browser dev tools. To also generate source maps for the JupyterLab core extensions, you can run the following command:

```bash
jupyter lab build --minimize=False
```

### Uninstall

```bash
pip uninstall jupyterlab_notify
```

## Publishing

Before starting, you'll need to have run: `pip install twine jupyter_packaging`

1. Update the version in `package.json` and update the release date in `CHANGELOG.md`
2. Commit the change in step 1, tag it, then push it

```
git commit -am <msg>
git tag vX.Z.Y
git push && git push --tags
```

3. Create the artifacts

```
rm -rf dist
python setup.py sdist bdist_wheel
```

4. Test this against the test pypi. You can then install from here to test as well:

```
twine upload --repository-url https://test.pypi.org/legacy/ dist/*
# In a new venv
pip install --index-url https://test.pypi.org/simple/ jupyterlab_notify
```

5. Upload this to pypi:

```
twine upload dist/*
```

### Uninstall

```bash
pip uninstall jupyterlab_notify
```

## History

This plugin was contributed back to the community by the [D. E. Shaw group](https://www.deshaw.com/).

<p align="center">
    <a href="https://www.deshaw.com">
       <img src="https://www.deshaw.com/assets/logos/blue_logo_417x125.png" alt="D. E. Shaw Logo" height="75" >
    </a>
</p>

## License

This project is released under a [BSD-3-Clause license](https://github.com/deshaw/jupyterlab-notify/blob/master/LICENSE.txt).

We love contributions! Before you can contribute, please sign and submit this [Contributor License Agreement (CLA)](https://www.deshaw.com/oss/cla).
This CLA is in place to protect all users of this project.

"Jupyter" is a trademark of the NumFOCUS foundation, of which Project Jupyter is a part.

[pypi-url]: https://pypi.org/project/jupyterlab-notify
[pypi-image]: https://img.shields.io/pypi/v/jupyterlab-notify
[pypi-dm-image]: https://img.shields.io/pypi/dm/jupyterlab-notify
[github-status-image]: https://github.com/deshaw/jupyterlab-notify/workflows/Build/badge.svg
[github-status-url]: https://github.com/deshaw/jupyterlab-notify/actions?query=workflow%3ABuild
[binder-image]: https://mybinder.org/badge_logo.svg
[binder-url]: https://mybinder.org/v2/gh/deshaw/jupyterlab-notify.git/main?urlpath=lab%2Ftree%2Fnotebooks%2Findex.ipynb
