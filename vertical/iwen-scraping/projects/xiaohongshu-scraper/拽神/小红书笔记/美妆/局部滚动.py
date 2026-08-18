from DrissionPage import Chromium


web = Chromium()
tab = web.latest_tab


tab.get('https://www.xiaohongshu.com/explore/68a6f57a000000001c034c0a?xsec_token=ABFUjMLpYmWUi-Sn3Q-rUf7kGeQo_laDcJQoyQocx_bUQ=&xsec_source=pc_search&source=unknown')
scrypt = """
    ele = document.getElementsByClassName('list-container');
    ele[0].scrollIntoView({behavior:"smooth",block:"end",inline:"nearest"});
"""
for i in range(10):
    tab.run_js(scrypt)
    tab.wait(3)