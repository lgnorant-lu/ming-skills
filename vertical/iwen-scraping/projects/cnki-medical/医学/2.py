import requests

cookies = {
    'UM_distinctid': '196b0e8e0572b7-047a0ce37bad0b8-26011f51-fa000-196b0e8e05840c',
    'Ecp_ClientId': 'a250603160900859783',
    'Ecp_IpLoginFail': '250603120.207.170.57',
    'SID_kns_new': 'kns018107',
    'SID_sug': '018108',
    'knsadv-searchtype': '%7B%22BLZOG7CK%22%3A%22gradeSearch%2CmajorSearch%22%2C%22MPMFIG1A%22%3A%22gradeSearch%2CmajorSearch%2CsentenceSearch%22%2C%22T2VC03OH%22%3A%22gradeSearch%2CmajorSearch%22%2C%22JQIRZIYA%22%3A%22gradeSearch%2CmajorSearch%2CsentenceSearch%22%2C%22S81HNSV3%22%3A%22gradeSearch%22%2C%22YSTT4HG0%22%3A%22gradeSearch%2CmajorSearch%2CauthorSearch%2CsentenceSearch%22%2C%22ML4DRIDX%22%3A%22gradeSearch%2CmajorSearch%22%2C%22WQ0UVIAA%22%3A%22gradeSearch%2CmajorSearch%22%2C%22VUDIXAIY%22%3A%22gradeSearch%2CmajorSearch%22%2C%22NN3FJMUV%22%3A%22gradeSearch%2CmajorSearch%2CauthorSearch%2CsentenceSearch%22%2C%22LSTPFY1C%22%3A%22gradeSearch%2CmajorSearch%2CsentenceSearch%22%2C%22HHCPM1F8%22%3A%22gradeSearch%2CmajorSearch%22%2C%22OORPU5FE%22%3A%22gradeSearch%2CmajorSearch%22%2C%22WD0FTY92%22%3A%22gradeSearch%2CmajorSearch%2CauthorSearch%2CsentenceSearch%22%2C%22BPBAFJ5S%22%3A%22gradeSearch%2CmajorSearch%2CauthorSearch%2CsentenceSearch%22%2C%22EMRPGLPA%22%3A%22gradeSearch%2CmajorSearch%22%2C%22PWFIRAGL%22%3A%22gradeSearch%2CmajorSearch%2CsentenceSearch%22%2C%22U8J8LYLV%22%3A%22gradeSearch%2CmajorSearch%22%2C%22R79MZMCB%22%3A%22gradeSearch%22%2C%22J708GVCE%22%3A%22gradeSearch%2CmajorSearch%22%2C%22HR1YT1Z9%22%3A%22gradeSearch%2CmajorSearch%22%2C%22JUP3MUPD%22%3A%22gradeSearch%2CmajorSearch%2CauthorSearch%2CsentenceSearch%22%2C%22NLBO1Z6R%22%3A%22gradeSearch%2CmajorSearch%22%2C%22RMJLXHZ3%22%3A%22gradeSearch%2CmajorSearch%2CsentenceSearch%22%2C%221UR4K4HZ%22%3A%22gradeSearch%2CmajorSearch%2CauthorSearch%2CsentenceSearch%22%2C%22NB3BWEHK%22%3A%22gradeSearch%2CmajorSearch%22%2C%22XVLO76FD%22%3A%22gradeSearch%2CmajorSearch%22%7D',
    'knsLeftGroupSelectItem': '',
    'KNS2COOKIE': '1748938897.437.52959.587452|b25e41a932fd162af3b8c5cff4059fc3',
    'SID_restapi': 'kns018104',
    'dblang': 'both',
    'tfstk': 'gtYSXTXzP82WNhbLOgc4l9KSMD_CPjuw9W1psBUz9aQ-dHOd3USeU3-XAdROeaRFUSBdHdKyY0frO6dBCzryL9JjRK994J8Bty1p9pclLbm2ZQbhJAkwdVRkZlNFTfhN2-hdT_6KggQzmSwGJAkZu4QN_E_pLDUthxOAn6ZLywpdDqCPH8EJpTIYH11GJwpdprEAa158JwI-GIBcOwBppghfktfKNawfi062NbPOVBMu6vXRhyUplsHhHQwLxtLONDXMatMTTEaGVOdRhyHJtcjfdtYt3mODp3pPipgshNKMhesOR4wGNnd1kT7tfo_WgLY1yFM7zsSCFnLRcWUpNZxRjH9SFuXJ4KsGMiFISsJNHQYJcX2vwdW5ysIqWfOAvn8ljUkYPNKMaa-pBxrPeh1d4PzNC1k3ASsgRs6ZGjZ3xYgXWEB2BaLl2sfV7jGbbkjRis6ZGjZ3xgCcilljGlrh.',
}

headers = {
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Origin': 'https://kns.cnki.net',
    'Pragma': 'no-cache',
    'Referer': 'https://kns.cnki.net/kns8s/defaultresult/index?crossids=YSTT4HG0%2CLSTPFY1C%2CJUP3MUPD%2CMPMFIG1A%2CWQ0UVIAA%2CBLZOG7CK%2CPWFIRAGL%2CEMRPGLPA%2CNLBO1Z6R%2CNN3FJMUV&korder=SU&kw=%E5%84%BF%E7%A7%91%E5%AD%A6',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    # 'Cookie': 'UM_distinctid=196b0e8e0572b7-047a0ce37bad0b8-26011f51-fa000-196b0e8e05840c; Ecp_ClientId=a250603160900859783; Ecp_IpLoginFail=250603120.207.170.57; SID_kns_new=kns018107; SID_sug=018108; knsadv-searchtype=%7B%22BLZOG7CK%22%3A%22gradeSearch%2CmajorSearch%22%2C%22MPMFIG1A%22%3A%22gradeSearch%2CmajorSearch%2CsentenceSearch%22%2C%22T2VC03OH%22%3A%22gradeSearch%2CmajorSearch%22%2C%22JQIRZIYA%22%3A%22gradeSearch%2CmajorSearch%2CsentenceSearch%22%2C%22S81HNSV3%22%3A%22gradeSearch%22%2C%22YSTT4HG0%22%3A%22gradeSearch%2CmajorSearch%2CauthorSearch%2CsentenceSearch%22%2C%22ML4DRIDX%22%3A%22gradeSearch%2CmajorSearch%22%2C%22WQ0UVIAA%22%3A%22gradeSearch%2CmajorSearch%22%2C%22VUDIXAIY%22%3A%22gradeSearch%2CmajorSearch%22%2C%22NN3FJMUV%22%3A%22gradeSearch%2CmajorSearch%2CauthorSearch%2CsentenceSearch%22%2C%22LSTPFY1C%22%3A%22gradeSearch%2CmajorSearch%2CsentenceSearch%22%2C%22HHCPM1F8%22%3A%22gradeSearch%2CmajorSearch%22%2C%22OORPU5FE%22%3A%22gradeSearch%2CmajorSearch%22%2C%22WD0FTY92%22%3A%22gradeSearch%2CmajorSearch%2CauthorSearch%2CsentenceSearch%22%2C%22BPBAFJ5S%22%3A%22gradeSearch%2CmajorSearch%2CauthorSearch%2CsentenceSearch%22%2C%22EMRPGLPA%22%3A%22gradeSearch%2CmajorSearch%22%2C%22PWFIRAGL%22%3A%22gradeSearch%2CmajorSearch%2CsentenceSearch%22%2C%22U8J8LYLV%22%3A%22gradeSearch%2CmajorSearch%22%2C%22R79MZMCB%22%3A%22gradeSearch%22%2C%22J708GVCE%22%3A%22gradeSearch%2CmajorSearch%22%2C%22HR1YT1Z9%22%3A%22gradeSearch%2CmajorSearch%22%2C%22JUP3MUPD%22%3A%22gradeSearch%2CmajorSearch%2CauthorSearch%2CsentenceSearch%22%2C%22NLBO1Z6R%22%3A%22gradeSearch%2CmajorSearch%22%2C%22RMJLXHZ3%22%3A%22gradeSearch%2CmajorSearch%2CsentenceSearch%22%2C%221UR4K4HZ%22%3A%22gradeSearch%2CmajorSearch%2CauthorSearch%2CsentenceSearch%22%2C%22NB3BWEHK%22%3A%22gradeSearch%2CmajorSearch%22%2C%22XVLO76FD%22%3A%22gradeSearch%2CmajorSearch%22%7D; knsLeftGroupSelectItem=; KNS2COOKIE=1748938897.437.52959.587452|b25e41a932fd162af3b8c5cff4059fc3; SID_restapi=kns018104; dblang=both; tfstk=gtYSXTXzP82WNhbLOgc4l9KSMD_CPjuw9W1psBUz9aQ-dHOd3USeU3-XAdROeaRFUSBdHdKyY0frO6dBCzryL9JjRK994J8Bty1p9pclLbm2ZQbhJAkwdVRkZlNFTfhN2-hdT_6KggQzmSwGJAkZu4QN_E_pLDUthxOAn6ZLywpdDqCPH8EJpTIYH11GJwpdprEAa158JwI-GIBcOwBppghfktfKNawfi062NbPOVBMu6vXRhyUplsHhHQwLxtLONDXMatMTTEaGVOdRhyHJtcjfdtYt3mODp3pPipgshNKMhesOR4wGNnd1kT7tfo_WgLY1yFM7zsSCFnLRcWUpNZxRjH9SFuXJ4KsGMiFISsJNHQYJcX2vwdW5ysIqWfOAvn8ljUkYPNKMaa-pBxrPeh1d4PzNC1k3ASsgRs6ZGjZ3xYgXWEB2BaLl2sfV7jGbbkjRis6ZGjZ3xgCcilljGlrh.',
}

data = {
    'boolSearch': 'true',
    'QueryJson': '{"Platform":"","Resource":"CROSSDB","Classid":"WD0FTY92","Products":"CJFQ,CAPJ,CJTL,CDFD,CMFD,CPFD,IPFD,CPVD,CCND,SCSF,SCHF,SCSD,SNAD,CCJD,WBFD,CCVD,CJFN","QNode":{"QGroup":[{"Key":"Subject","Title":"","Logic":0,"Items":[{"Field":"SU","Value":"儿科学","Operator":"TOPRANK","Logic":0,"Title":"主题"}],"ChildItems":[]},{"Key":"SCDBGroup","Title":"","Logic":0,"Items":[],"ChildItems":[{"Key":"ZYZT|||CYZT","Title":"","Logic":0,"Items":[{"Key":"儿科学","Title":"儿科学","Logic":1,"Field":"ZYZT","Operator":"DEFAULT","Value":"儿科学","Value2":"","Name":"ZYZT"}],"ChildItems":[]}]}]},"ExScope":1,"SearchType":2,"Rlang":"CHINESE","KuaKuCode":"YSTT4HG0,LSTPFY1C,JUP3MUPD,MPMFIG1A,WQ0UVIAA,BLZOG7CK,PWFIRAGL,EMRPGLPA,NLBO1Z6R,NN3FJMUV","Expands":{},"SearchFrom":2}',
    'pageNum': '1',
    'pageSize': '20',
    'dstyle': 'listmode',
    'boolSortSearch': 'false',
    'productStr': 'YSTT4HG0,LSTPFY1C,RMJLXHZ3,JQIRZIYA,JUP3MUPD,1UR4K4HZ,BPBAFJ5S,R79MZMCB,MPMFIG1A,WQ0UVIAA,NB3BWEHK,XVLO76FD,HR1YT1Z9,BLZOG7CK,PWFIRAGL,EMRPGLPA,J708GVCE,ML4DRIDX,NLBO1Z6R,NN3FJMUV,',
    'aside': '主题：儿科学',
    'searchFrom': '资源范围：总库',
    'subject': '',
    'language': '',
    'uniplatform': '',
    'CurPage': '1',
}

response = requests.post('https://kns.cnki.net/kns8s/brief/grid', cookies=cookies, headers=headers, data=data)

print(response.text)