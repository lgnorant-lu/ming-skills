import hashlib
from urllib.parse import urlencode


data = {
    "data_type": "1",
    "page": "2",
    "platform": "web"
}
da = urlencode(data)
print(da)


def sha1(data):
    sha1 = hashlib.sha1()
    sha1.update(da.encode('utf-8'))
    return sha1.hexdigest()


print(sha1(da))