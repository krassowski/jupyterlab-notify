from .config import NotificationConfig

testNoti = NotificationConfig()
print(testNoti.slack_token)
print(testNoti.slack_user_id)
print(testNoti.slack_channel_name)
print(testNoti.email)