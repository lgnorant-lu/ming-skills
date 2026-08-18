heng_xhr = new XMLHttpRequest();
heng_xhr.open('post','https://qikan.cqvip.com/Search/SearchList')
heng_xhr.setRequestHeader('content-type','application/x-www-form-urlencoded; charset=UTF-8')
// js发送ajax的时候
// form data ->xxx=xxx&xxx=xxx
// request payload ->{xxx:xxx,xxx:xxx}
heng_xhr.send('searchParamModel=%7B%22ObjectType%22%3A1%2C%22SearchKeyList%22%3A%5B%5D%2C%22SearchExpression%22%3Anull%2C%22BeginYear%22%3Anull%2C%22EndYear%22%3Anull%2C%22UpdateTimeType%22%3Anull%2C%22JournalRange%22%3Anull%2C%22DomainRange%22%3Anull%2C%22ClusterFilter%22%3A%22%22%2C%22ClusterLimit%22%3A0%2C%22ClusterUseType%22%3A%22Article%22%2C%22UrlParam%22%3A%22%22%2C%22Sort%22%3A%220%22%2C%22SortField%22%3Anull%2C%22UserID%22%3A%220%22%2C%22PageNum%22%3A2%2C%22PageSize%22%3A20%2C%22SType%22%3Anull%2C%22StrIds%22%3Anull%2C%22IsRefOrBy%22%3A0%2C%22ShowRules%22%3A%22%22%2C%22IsNoteHistory%22%3A0%2C%22AdvShowTitle%22%3Anull%2C%22ObjectId%22%3Anull%2C%22ObjectSearchType%22%3A0%2C%22ChineseEnglishExtend%22%3A0%2C%22SynonymExtend%22%3A0%2C%22ShowTotalCount%22%3A78206819%2C%22AdvTabGuid%22%3A%22%22%7D');