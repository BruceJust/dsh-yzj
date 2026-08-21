# workreport-form-service (pid=38)

- **basepath**: ``
- **接口总数**: 7

## 公共分类 (1)

- [获取服务器当前时间](#获取服务器当前时间--workflow-api-v1-workreport-pro-getcurrservertime) `POST`

### 获取服务器当前时间

- **接口ID**: 23727
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workflow/api/v1/workreport/pro/getCurrServerTime`
- **状态**: undone
- **维护人**: xueyuz_zheng
- **更新时间**: 2022-06-22 15:36:19

**说明**

<p>成功返回：<br>
<span class="colour" style="color: rgb(0, 0, 0);">{</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color: rgb(163, 21, 21);">"data"</span><span class="colour" style="color: rgb(0, 0, 0);">:&nbsp;</span><span class="colour" style="color: rgb(9, 134, 88);">1655883295322</span><span class="colour" style="color: rgb(0, 0, 0);">,</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color: rgb(163, 21, 21);">"error"</span><span class="colour" style="color: rgb(0, 0, 0);">:&nbsp;</span><span class="colour" style="color: rgb(4, 81, 165);">"success"</span><span class="colour" style="color: rgb(0, 0, 0);">,</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color: rgb(163, 21, 21);">"errorCode"</span><span class="colour" style="color: rgb(0, 0, 0);">:&nbsp;</span><span class="colour" style="color: rgb(9, 134, 88);">200</span><span class="colour" style="color: rgb(0, 0, 0);">,</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color: rgb(163, 21, 21);">"success"</span><span class="colour" style="color: rgb(0, 0, 0);">:&nbsp;</span><span class="colour" style="color: rgb(4, 81, 165);"><strong>true</strong></span><br>
<span class="colour" style="color: rgb(0, 0, 0);">}</span></p>

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/x-www-form-urlencoded |  |  |

**响应** (json)

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "data": {
      "type": "number",
      "description": "服务器时间戳"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "number"
    },
    "success": {
      "type": "boolean"
    }
  }
}
```

---

## 关键字搜索 (2)

- [数据初始化查询接口](#数据初始化查询接口--com-yunzhijia-workreport-service-outer-workreportouterservice-getworkreportbytime) `POST`
- [汇报搜索](#汇报搜索--workreport-rest-v1-searchreport) `POST`

### 数据初始化查询接口

- **接口ID**: 22911
- **分类**: 关键字搜索
- **请求方式**: `POST`
- **路径**: `/com.yunzhijia.workreport.service.outer.WorkReportOuterService#getWorkReportByTime`
- **状态**: undone
- **维护人**: xueyuz_zheng
- **更新时间**: 2022-06-02 15:01:09

**说明**

<p>请求实例：<br>
1.按照时间范围查询<br>
{<br>
"submitTimeStart":"1646064000000",<br>
"submitTimeEnd":"1651334400000",<br>
"pageSize":"2",<br>
"type":"first",<br>
"workreportId":null<br>
}<br>
2.按照workReportId查询<br>
{<br>
"workreportId":"629858d417ac997ef48e867f"<br>
}<br>
3.按照eid查询,可传时间范围，可分页<br>
{<br>
"eid":"050040",<br>
"submitTimeStart":"1646064000000",<br>
"submitTimeEnd":"1651334400000",<br>
"pageSize":"2",<br>
"type":"first",<br>
"workreportId":null<br>
}<br>
4.按照creator查询，可传时间范围，可分页<br>
{<br>
"creator":"050040",<br>
"submitTimeStart":"1646064000000",<br>
"submitTimeEnd":"1651334400000",<br>
"pageSize":"2",<br>
"type":"first",<br>
"workreportId":null<br>
}</p>
<p>返回实例：<br>
{<br>
"data": [{<br>
"content": "本周工作总结***asdasa",<br>
"createTime": 1651804950181,<br>
"creator": "62205725e4b0293b041adbdc",<br>
"eid": "87025750",<br>
"name": "颜慧妹",<br>
"photoUrl": "<a href="https://dev.kdweibo.cn/space/c/photo/load?id=5f449792da3199000139bf87">https://dev.kdweibo.cn/space/c/photo/load?id=5f449792da3199000139bf87</a>",<br>
"submitTime": 1650873773246,<br>
"title": "颜慧妹的2022年第18周的周报",<br>
"workreportId": "626655ad088bd4000101d82b"<br>
}],<br>
"error": "success",<br>
"errorCode": 200,<br>
"success": true<br>
}</p>

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "submitTimeStart": {
      "type": "string",
      "description": "汇报查询开始时间"
    },
    "submitTimeEnd": {
      "type": "string",
      "description": "汇报查询结束时间"
    },
    "pageSize": {
      "type": "string",
      "description": "每页大小"
    },
    "type": {
      "type": "string",
      "description": "type:first，查询第一页，\ntype:next,查询下一页"
    },
    "workReportId": {
      "type": "string",
      "description": "type:first时传null，\ntype:next时传上一页最后一条数据的workreportId"
    },
    "eid": {
      "type": "string",
      "description": "汇报对应的eid"
    },
    "creator": {
      "type": "string",
      "description": "汇报创建者"
    }
  },
  "required": [
    "eid"
  ]
}
```

**响应** (json)

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "content": {
            "type": "string"
          },
          "createTime": {
            "type": "number"
          },
          "creator": {
            "type": "string"
          },
          "eid": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "photoUrl": {
            "type": "string"
          },
          "submitTime": {
            "type": "number"
          },
          "title": {
            "type": "string"
          },
          "workReportId": {
            "type": "string"
          }
        },
        "required": [
          "content",
          "createTime",
          "creator",
          "eid",
          "name",
          "photoUrl",
          "submitTime",
          "title",
          "workReportId"
        ]
      }
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "number"
    },
    "success": {
      "type": "boolean"
    }
  }
}
```

---

### 汇报搜索

- **接口ID**: 22929
- **分类**: 关键字搜索
- **请求方式**: `POST`
- **路径**: `/workreport/rest/v1/searchReport`
- **状态**: undone
- **维护人**: xueyuz_zheng
- **更新时间**: 2022-05-13 14:47:09

**说明**

<p>请求参数<br>
<span class="colour" style="color:rgb(0, 0, 0)">{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"keyword"</span><span class="colour" style="color:rgb(0, 0, 0)">:</span><span class="colour" style="color:rgb(4, 81, 165)">"999"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"pageIndex"</span><span class="colour" style="color:rgb(0, 0, 0)">:</span><span class="colour" style="color:rgb(9, 134, 88)">0</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"pageRows"</span><span class="colour" style="color:rgb(0, 0, 0)">:</span><span class="colour" style="color:rgb(9, 134, 88)">10</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">}</span></p>
<p>返回示例<br>
<span class="colour" style="color:rgb(0, 0, 0)">{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"result"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"highlight"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"627b17e7f329d10001dba347"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"content"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;[</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"上周工作总结:99999。\t本周工作计划:&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;。\t"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;]</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"627b187cf329d10001dba34b"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"content"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;[</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"上周工作总结:&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;。\t本周工作计划:111111111111111。\t"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;]</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"6274eb082c9e1d0001148122"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"content"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;[</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;。\n111111111。\n333333333。\n2222。\n4444444。\n55555555555555。\n"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;]</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"627a173115b6680001267993"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"content"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;[</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"明日工作计划:111111111。\t今日工作总结:88888888888\n999999\n&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;\n&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;&lt;em&nbsp;class="highlight"&gt;6&lt;/em&gt;\n88\n1。\t"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;]</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"numFound"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(9, 134, 88)">4</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"hasMore"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)"><strong>false</strong></span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"list"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;[</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"eid"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"87025750"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"photoUrl"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"<a href="https://dev.kdweibo.cn/space/c/photo/load?id=5f0d4b98d346b800018b8d0c">https://dev.kdweibo.cn/space/c/photo/load?id=5f0d4b98d346b800018b8d0c</a>"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"workReportId"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"6274eb082c9e1d0001148122"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"creator"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"5f1530794b150100010e3d00"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"submitTime"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"2022-05-06T09:31:52.799Z"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"createTime"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"2022-05-10T01:22:15.433Z"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"title"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"郑学宇的2022年05月06日的bug生产者"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"eid"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"87025750"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"photoUrl"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"<a href="https://dev.kdweibo.cn/space/c/photo/load?id=5f449792da3199000139bf87">https://dev.kdweibo.cn/space/c/photo/load?id=5f449792da3199000139bf87</a>"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"workReportId"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"627b17e7f329d10001dba347"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"creator"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"62205725e4b0293b041adbdc"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"submitTime"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(9, 134, 88)">1652234215645</span><span class="colour" style="color:rgb(0, 0, 0)">,~~~~</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"createTime"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(9, 134, 88)">1652234215645</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"title"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"颜慧妹的2022年第20周的周报"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"eid"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"87025750"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"photoUrl"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"<a href="https://dev.kdweibo.cn/space/c/photo/load?id=5f449792da3199000139bf87">https://dev.kdweibo.cn/space/c/photo/load?id=5f449792da3199000139bf87</a>"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"workReportId"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"627b187cf329d10001dba34b"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"creator"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"62205725e4b0293b041adbdc"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"submitTime"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(9, 134, 88)">1652234364082</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"createTime"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(9, 134, 88)">1652234364082</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"title"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"颜慧妹的2022年第20周的周报"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"eid"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"87025750"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"photoUrl"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"<a href="https://dev.kdweibo.cn/space/c/photo/load?id=5f449792da3199000139bf87">https://dev.kdweibo.cn/space/c/photo/load?id=5f449792da3199000139bf87</a>"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"workReportId"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"627a173115b6680001267993"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"creator"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"62205725e4b0293b041adbdc"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"submitTime"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(9, 134, 88)">1652170848779</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"createTime"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(9, 134, 88)">1652168497679</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"title"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"颜慧妹的2022年05月10日的日报"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;]</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;},</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"success"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)"><strong>true</strong></span><br>
<span class="colour" style="color:rgb(0, 0, 0)">}</span></p>

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "keyword": {
      "type": "string"
    },
    "pageIndex": {
      "type": "number"
    },
    "pageRows": {
      "type": "number"
    }
  }
}
```

**响应** (json)

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "data": {
      "type": "object",
      "properties": {
        "highlight": {
          "type": "object",
          "properties": {
            "123456": {
              "type": "object",
              "properties": {
                "title": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "content": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "description": "工作汇报id"
            },
            "333555777": {
              "type": "object",
              "properties": {
                "content": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "description": "工作汇报id"
            },
            "369258147": {
              "type": "object",
              "properties": {
                "title": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "description": "工作汇报id"
            },
            "987654321": {
              "type": "object",
              "properties": {
                "content": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "description": "工作汇报id"
            },
            "1064258568": {
              "type": "object",
              "properties": {
                "title": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "content": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "description": "工作汇报id"
            },
            "1234567890": {
              "type": "object",
              "properties": {
                "title": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "content": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "description": "工作汇报id"
            }
          }
        },
        "numFound": {
          "type": "number"
        },
        "hasMore": {
          "type": "boolean"
        },
        "list": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "eid": {
                "type": "string"
              },
              "workReportId": {
                "type": "string"
              },
              "creator": {
                "type": "string"
              },
              "submitTime": {
                "type": "string"
              },
              "title": {
                "type": "string"
              }
            },
            "required": [
              "eid",
              "workReportId",
              "creator",
              "submitTime",
              "title"
            ]
          }
        }
      }
    },
    "code": {
      "type": "number"
    },
    "success": {
      "type": "boolean"
    },
    "errorMsg": {
      "type": "null"
    },
    "msg": {
      "type": "null"
    }
  }
}
```

---

## 消息卡片需求 (4)

- [根据workReportId查询对应模板分享规则](#根据workreportid查询对应模板分享规则--workflow-api-v1-workreport-new-getsharerule) `POST`
- [查询工作汇报最新的消息卡片模板](#查询工作汇报最新的消息卡片模板--workflow-api-v1-workreport-new-getcardtemplate) `POST`
- [创建消息卡片模板](#创建消息卡片模板--workflow-api-v1-workreport-new-pubreportcardtemplate) `POST`
- [保存汇报消息卡片分享记录](#保存汇报消息卡片分享记录--workflow-api-v1-workreport-new-savesharerecord) `POST`

### 根据workReportId查询对应模板分享规则

- **接口ID**: 23433
- **分类**: 消息卡片需求
- **请求方式**: `POST`
- **路径**: `/workflow/api/v1/workreport/new/getShareRule`
- **状态**: undone
- **维护人**: xueyuz_zheng
- **更新时间**: 2022-06-10 17:13:23

**说明**

<p>正常返回：<br>
{"data":{"shareRule":0},"error":"success","errorCode":200,"success":true}<br>
异常返回：<br>
{"data":null,"error":"汇报不存在","errorCode":500,"success":false}<br>
{"data":null,"error":"汇报对应模板已删除~~~~","errorCode":500,"success":false}</p>

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "workReportId": {
      "type": "string",
      "description": "工作汇报id"
    }
  }
}
```

**响应** (json)

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "data": {
      "type": "object",
      "properties": {
        "shareRule": {
          "type": "number",
          "description": "分享规则\n0 允许分享至任意用户或群聊，默认值\n1 仅允许分享至内部用户或内部群\n2 不允许分享"
        }
      }
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "number"
    },
    "success": {
      "type": "boolean"
    }
  }
}
```

---

### 查询工作汇报最新的消息卡片模板

- **接口ID**: 23535
- **分类**: 消息卡片需求
- **请求方式**: `POST`
- **路径**: `/workflow/api/v1/workreport/new/getCardTemplate`
- **状态**: undone
- **维护人**: xueyuz_zheng
- **更新时间**: 2022-06-15 14:37:18

**说明**

<p>请求参数：<br>
{<br>
“type”:"add"<br>
}<br>
正常返回<br>
<span class="colour" style="color:rgb(0, 0, 0)">{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"data"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"62a6d0afe4b0974b0ed01073"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"error"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"success"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"errorCode"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(9, 134, 88)">200</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"success"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)"><strong>true</strong></span><br>
<span class="colour" style="color:rgb(0, 0, 0)">}</span></p>

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "description": "add:新增汇报消息卡片用的模板类型，delete:删除汇报后发送卡片消息用的模板类型"
    }
  }
}
```

**响应** (json)

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "data": {
      "type": "string",
      "description": "消息卡片模板id"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "number"
    },
    "success": {
      "type": "boolean"
    }
  }
}
```

---

### 创建消息卡片模板

- **接口ID**: 23541
- **分类**: 消息卡片需求
- **请求方式**: `POST`
- **路径**: `/workflow/api/v1/workreport/new/pubReportCardTemplate`
- **状态**: undone
- **维护人**: xueyuz_zheng
- **更新时间**: 2022-06-10 17:12:56

**说明**

<p>请求示例：<br>
<span class="colour" style="color:rgb(0, 0, 0)">{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"key"</span><span class="colour" style="color:rgb(0, 0, 0)">:</span><span class="colour" style="color:rgb(4, 81, 165)">"bb8b6a73-34f9-4ab6-8a28-78a0e295cc21"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"content"</span><span class="colour" style="color:rgb(0, 0, 0)">:{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"$schema"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"<a href="http://adaptivecards.io/schemas/adaptive-card.json">http://adaptivecards.io/schemas/adaptive-card.json</a>"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"AdaptiveCard"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"body"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;[</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"columns"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;[</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"width"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"auto"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"verticalContentAlignment"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Center"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Column"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"items"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;[</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"width"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"18px"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Image"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"url"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"<a href="https://www.yunzhijia.com/docrest/file/downloadfile/629f313df4c6a40001adcadb">https://www.yunzhijia.com/docrest/file/downloadfile/629f313df4c6a40001adcadb</a>"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"height"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"18px"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;]</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"spacing"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Small"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"width"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"stretch"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"verticalContentAlignment"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Center"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Column"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"items"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;[</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"horizontalAlignment"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Left"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"size"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Small"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"color"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Default"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"weight"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Default"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"text"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"${appName}"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"TextBlock"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"wrap"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)"><strong>true</strong></span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"isSubtle"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)"><strong>true</strong></span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;]</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;],</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"ColumnSet"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"spacing"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Medium"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"size"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Medium"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"weight"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Bolder"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"text"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"${title}"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"TextBlock"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"wrap"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)"><strong>true</strong></span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"maxLines"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(9, 134, 88)">3</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Container"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"items"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;[</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Container"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"$data"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"${contentBlocks}"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"items"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;[</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"ColumnSet"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"columns"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;[</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Column"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"width"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"auto"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"items"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;[</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Image"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"width"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"3px"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"height"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"12px"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"url"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"<a href="https://www.yunzhijia.com/docrest/file/downloadfile/62a194cac8dca400010ac885">https://www.yunzhijia.com/docrest/file/downloadfile/62a194cac8dca400010ac885</a>"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;],</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"verticalContentAlignment"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Center"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Column"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"width"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"stretch"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"items"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;[</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"TextBlock"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"text"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"${title}"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"wrap"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)"><strong>true</strong></span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"maxLines"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(9, 134, 88)">1</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"weight"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Bolder"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;],</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"spacing"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Small"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;]</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"TextBlock"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"text"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"${content}"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"wrap"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)"><strong>true</strong></span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"spacing"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"None"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"maxLines"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(9, 134, 88)">3</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;],</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"spacing"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Medium"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;],</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"spacing"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"ExtraLarge"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"separator"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)"><strong>true</strong></span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"spacing"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Medium"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"ActionSet"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"actions"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;[</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"type"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"Action.OpenUrl"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"title"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"${buttonTitle}"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"url"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"${buttonJumpUrl}"</span><span class="colour" style="color:rgb(0, 0, 0)">,</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"style"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"positive"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;]</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;],</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color:rgb(163, 21, 21)">"version"</span><span class="colour" style="color:rgb(0, 0, 0)">:&nbsp;</span><span class="colour" style="color:rgb(4, 81, 165)">"1.4"</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">}</span><br>
<span class="colour" style="color:rgb(0, 0, 0)">}</span><br>
正常返回：<br>
<span class="colour" style="color:rgb(85, 85, 85)">{"data":"62a2fc8de4b0974b0ed01062","error":"success","errorCode":200,"success":true}</span></p>

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "key": {
      "type": "string",
      "description": "验证的key"
    },
    "content": {
      "type": "object",
      "properties": {
        "$schema": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "body": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "columns": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "width": {
                      "type": "string"
                    },
                    "verticalContentAlignment": {
                      "type": "string"
                    },
                    "type": {
                      "type": "string"
                    },
                    "items": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "width": {
                            "type": "string"
                          },
                          "type": {
                            "type": "string"
                          },
                          "url": {
                            "type": "string"
                          },
                          "height": {
                            "type": "string"
                          },
                          "horizontalAlignment": {
                            "type": "string"
                          },
                          "size": {
                            "type": "string"
                          },
                          "color": {
                            "type": "string"
                          },
                          "weight": {
                            "type": "string"
                          },
                          "text": {
                            "type": "string"
                          },
                          "wrap": {
                            "type": "boolean"
                          },
                          "isSubtle": {
                            "type": "boolean"
                          }
                        },
                        "required": [
                          "type"
                        ]
                      }
                    },
                    "spacing": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "width",
                    "verticalContentAlignment",
                    "type",
                    "items"
                  ]
                }
              },
              "type": {
                "type": "string"
              },
              "spacing": {
                "type": "string"
              },
              "size": {
                "type": "string"
              },
              "weight": {
                "type": "string"
              },
              "text": {
                "type": "string"
              },
              "wrap": {
                "type": "boolean"
              },
              "maxLines": {
                "type": "number"
              },
              "items": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "type": {
                      "type": "string"
                    },
                    "$data": {
                      "type": "string"
                    },
                    "items": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "type": {
                            "type": "string"
                          },
                          "columns": {
                            "type": "array",
                            "items": {
                              "type": "object",
                              "properties": {
                                "type": {
                                  "type": "string"
                                },
                                "width": {
                                  "type": "string"
                                },
                                "items": {
                                  "type": "array",
                                  "items": {
                                    "type": "object",
                                    "properties": {
                                      "type": {
                                        "type": "string"
                                      },
                                      "width": {
                                        "type": "string"
                                      },
                                      "height": {
                                        "type": "string"
                                      },
                                      "url": {
                                        "type": "string"
                                      },
                                      "text": {
                                        "type": "string"
                                      },
                                      "wrap": {
                                        "type": "boolean"
                                      },
                                      "maxLines": {
                                        "type": "number"
                                      },
                                      "weight": {
                                        "type": "string"
                                      }
                                    },
                                    "required": [
                                      "type"
                                    ]
                                  }
                                },
                                "verticalContentAlignment": {
                                  "type": "string"
                                },
                                "spacing": {
                                  "type": "string"
                                }
                              },
                              "required": [
                                "type",
                                "width",
                                "items"
                              ]
                            }
                          },
                          "text": {
                            "type": "string"
                          },
                          "wrap": {
                            "type": "boolean"
                          },
                          "spacing": {
                            "type": "string"
                          },
                          "maxLines": {
                            "type": "number"
                          }
                        },
                        "required": [
                          "type"
                        ]
                      }
                    },
                    "spacing": {
                      "type": "string"
                    }
                  }
                }
              },
              "separator": {
                "type": "boolean"
              },
              "actions": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "type": {
                      "type": "string"
                    },
                    "title": {
                      "type": "string"
                    },
                    "url": {
                      "type": "string"
                    },
                    "style": {
                      "type": "string"
                    }
                  }
                }
              }
            },
            "required": [
              "type",
              "spacing"
            ]
          }
        },
        "version": {
          "type": "string"
        }
      },
      "description": "消息卡片模板对应的json串"
    }
  }
}
```

**响应** (json)

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "data": {
      "type": "string"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "number"
    },
    "success": {
      "type": "boolean"
    }
  }
}
```

---

### 保存汇报消息卡片分享记录

- **接口ID**: 23637
- **分类**: 消息卡片需求
- **请求方式**: `POST`
- **路径**: `/workflow/api/v1/workreport/new/saveShareRecord`
- **状态**: undone
- **维护人**: xueyuz_zheng
- **更新时间**: 2022-06-13 14:37:43

**说明**

<p>请求参数：<br>
<span class="colour" style="color: rgb(0, 0, 0);">{</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color: rgb(163, 21, 21);">"workReportId"</span><span class="colour" style="color: rgb(0, 0, 0);">:</span><span class="colour" style="color: rgb(4, 81, 165);">"62a03bc93a6c08000185eb50"</span><span class="colour" style="color: rgb(0, 0, 0);">,</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color: rgb(163, 21, 21);">"templateId"</span><span class="colour" style="color: rgb(0, 0, 0);">:</span><span class="colour" style="color: rgb(4, 81, 165);">"62a30af4e4b0974b0ed0106f"</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">}</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">正常返回：</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">{</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color: rgb(163, 21, 21);">"data"</span><span class="colour" style="color: rgb(0, 0, 0);">:&nbsp;</span><span class="colour" style="color: rgb(4, 81, 165);"><strong>null</strong></span><span class="colour" style="color: rgb(0, 0, 0);">,</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color: rgb(163, 21, 21);">"error"</span><span class="colour" style="color: rgb(0, 0, 0);">:&nbsp;</span><span class="colour" style="color: rgb(4, 81, 165);">"success"</span><span class="colour" style="color: rgb(0, 0, 0);">,</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color: rgb(163, 21, 21);">"errorCode"</span><span class="colour" style="color: rgb(0, 0, 0);">:&nbsp;</span><span class="colour" style="color: rgb(9, 134, 88);">200</span><span class="colour" style="color: rgb(0, 0, 0);">,</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="colour" style="color: rgb(163, 21, 21);">"success"</span><span class="colour" style="color: rgb(0, 0, 0);">:&nbsp;</span><span class="colour" style="color: rgb(4, 81, 165);"><strong>true</strong></span><br>
<span class="colour" style="color: rgb(0, 0, 0);">}</span></p>

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "workReportId": {
      "type": "string"
    },
    "templateId": {
      "type": "string"
    }
  }
}
```

**响应** (json)

```json
{
  "type": "object",
  "title": "empty object",
  "properties": {}
}
```

---
