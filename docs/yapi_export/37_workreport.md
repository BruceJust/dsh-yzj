# workreport (pid=37)

- **basepath**: ``
- **接口总数**: 2

## 按部门查询（包含子部门） (2)

- [移动端按部门查询](#移动端按部门查询--workreport-rest-v1-info-flow-team-reports-startdate-1647792000000-enddate-1647878399999-templateid-f54829db8ced4ad3aac8a080640e76c9-limit-10-page-1-isinclude-false-datasourcetype-thirdparty-startindexid--sourcetype-1-deptids-3519e4ae-870a-40d0-8e2f-41de3a4fd219-ticket-appurlwithticket7aa10b13068f52b31e5e33d0f63ba90a-appid-101091429-lappname-workreport-includesub-true) `POST`
- [web端按部门查询](#web端按部门查询--workreport-rest-v1-pc-dept-reports-ticket-appurlwithticketc5dbe6bb0199b9f28b8bda3e17565499-lappname-workreport-appid-101091429-includesub-true) `POST`

### 移动端按部门查询

- **接口ID**: 22143
- **分类**: 按部门查询（包含子部门）
- **请求方式**: `POST`
- **路径**: `/workreport/rest/v1/info-flow/team/reports?startDate=1647792000000&endDate=1647878399999&templateId=f54829db8ced4ad3aac8a080640e76c9&limit=10&page=1&isInclude=false&dataSourceType=THIRDPARTY&startIndexId=&sourceType=1&deptIds=3519e4ae-870a-40d0-8e2f-41de3a4fd219&ticket=APPURLWITHTICKET7aa10b13068f52b31e5e33d0f63ba90a&appId=101091429&lappName=workreport&includeSub=true`
- **状态**: undone
- **维护人**: xueyuz_zheng
- **更新时间**: 2022-03-21 15:35:46

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
    "codeId": {
      "type": "string"
    },
    "deptIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "startTime": {
      "type": "number"
    },
    "endTime": {
      "type": "number"
    },
    "minTime": {
      "type": "number"
    },
    "pageable": {
      "type": "object",
      "properties": {
        "pageSize": {
          "type": "number"
        },
        "type": {
          "type": "string"
        },
        "id": {
          "type": "null"
        }
      }
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

### web端按部门查询

- **接口ID**: 22149
- **分类**: 按部门查询（包含子部门）
- **请求方式**: `POST`
- **路径**: `/workreport/rest/v1/pc/dept/reports?ticket=APPURLWITHTICKETc5dbe6bb0199b9f28b8bda3e17565499&lappName=workreport&appId=101091429&includeSub=true`
- **状态**: undone
- **维护人**: xueyuz_zheng
- **更新时间**: 2022-03-21 15:58:18

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
    "codeId": {
      "type": "string"
    },
    "deptIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "endTime": {
      "type": "number"
    },
    "minTime": {
      "type": "number"
    },
    "pageable": {
      "type": "object",
      "properties": {
        "pageSize": {
          "type": "number"
        },
        "type": {
          "type": "string"
        },
        "id": {
          "type": "null"
        }
      }
    },
    "startTime": {
      "type": "number"
    }
  }
}
```

---
