# workassistant-ai-agent (pid=391)

- **basepath**: `/workassistant-ai-agent`
- **接口总数**: 83
- **项目说明**: 协同办公领域的agent开发工程

## 公共分类 (19)

- [/calendar/schedule/brief](#calendar-schedule-brief--workassistant-ai-agent-calendar-schedule-brief) `POST`
- [/inner/calendar/executive/brief](#inner-calendar-executive-brief--workassistant-ai-agent-inner-calendar-executive-brief) `POST`
- [/inner/system/config/setEnabled](#inner-system-config-setenabled--workassistant-ai-agent-inner-system-config-setenabled) `POST`
- [/inner/system/config/save](#inner-system-config-save--workassistant-ai-agent-inner-system-config-save) `POST`
- [/inner/system/config/saveBatch](#inner-system-config-savebatch--workassistant-ai-agent-inner-system-config-savebatch) `POST`
- [/inner/system/config/refreshCache](#inner-system-config-refreshcache--workassistant-ai-agent-inner-system-config-refreshcache) `POST`
- [/inner/system/config/map](#inner-system-config-map--workassistant-ai-agent-inner-system-config-map) `POST`
- [/inner/system/config/list](#inner-system-config-list--workassistant-ai-agent-inner-system-config-list) `POST`
- [/inner/system/config/get](#inner-system-config-get--workassistant-ai-agent-inner-system-config-get) `POST`
- [/inner/system/config/getValue](#inner-system-config-getvalue--workassistant-ai-agent-inner-system-config-getvalue) `POST`
- [/inner/system/config/delete](#inner-system-config-delete--workassistant-ai-agent-inner-system-config-delete) `POST`
- [/inner/system/config/deleteAll](#inner-system-config-deleteall--workassistant-ai-agent-inner-system-config-deleteall) `POST`
- [/inner/system/config/special-user-depts/remove](#inner-system-config-special-user-depts-remove--workassistant-ai-agent-inner-system-config-special-user-depts-remove) `POST`
- [/inner/system/config/special-user-depts/list](#inner-system-config-special-user-depts-list--workassistant-ai-agent-inner-system-config-special-user-depts-list) `POST`
- [/inner/system/config/special-user-depts/add](#inner-system-config-special-user-depts-add--workassistant-ai-agent-inner-system-config-special-user-depts-add) `POST`
- [【内部测试】直传文本流式生成](#内部测试-直传文本流式生成--workassistant-ai-agent-api-meeting-minutes-inner-test-stream) `POST`
- [流式生成会议纪要（路径 B 正式端点）](#流式生成会议纪要-路径-b-正式端点---workassistant-ai-agent-api-meeting-minutes-generate-stream) `POST`
- [查询最近一次成功结果（页面刷新后回显）](#查询最近一次成功结果-页面刷新后回显---workassistant-ai-agent-api-meeting-minutes-result--transcriptid) `GET`
- [查询最近一次成功结果（页面刷新后回显）](#查询最近一次成功结果-页面刷新后回显---workassistant-ai-agent-api-meeting-minutes-result--stenoid) `GET`

### /calendar/schedule/brief

- **接口ID**: 49974
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/calendar/schedule/brief`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-05-09 20:28:02
- **标签**: schedule-brief-open-api

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "openId": {
      "type": "string"
    },
    "currentTime": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/ScheduleBriefOpenRequest"
}
```

**响应** (raw)

```
OK
```

---

### /inner/calendar/executive/brief

- **接口ID**: 50423
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/calendar/executive/brief`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-06-25 16:46:02
- **标签**: inner-executive-brief-controller

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "openId": {
      "type": "string"
    },
    "currentTime": {
      "type": "string"
    },
    "timeRange": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/ExecutiveBriefRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "content": {
      "type": "string"
    },
    "executiveCount": {
      "type": "integer",
      "format": "int32"
    },
    "totalMeetingCount": {
      "type": "integer",
      "format": "int32"
    },
    "meetingsWithMinutes": {
      "type": "integer",
      "format": "int32"
    },
    "generatedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "$$ref": "#/components/schemas/ExecutiveBriefResponse"
}
```

---

### /inner/system/config/setEnabled

- **接口ID**: 50463
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/system/config/setEnabled`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-01 18:36:02
- **标签**: inner-system-config-controller

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "bizKey": {
      "type": "string"
    },
    "configKey": {
      "type": "string"
    },
    "enabled": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ConfigEnableRequest"
}
```

**响应** (raw)

```
OK
```

---

### /inner/system/config/save

- **接口ID**: 50471
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/system/config/save`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-01 18:36:02
- **标签**: inner-system-config-controller

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "bizKey": {
      "type": "string"
    },
    "configKey": {
      "type": "string"
    },
    "configValue": {
      "type": "string"
    },
    "description": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/ConfigSaveRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "bizKey": {
      "type": "string"
    },
    "configKey": {
      "type": "string"
    },
    "configValue": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedBy": {
      "type": "string"
    },
    "enabled": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/SystemConfigEntity"
}
```

---

### /inner/system/config/saveBatch

- **接口ID**: 50479
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/system/config/saveBatch`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-01 18:36:03
- **标签**: inner-system-config-controller

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "bizKey": {
      "type": "string"
    },
    "configs": {
      "type": "object",
      "additionalProperties": {
        "type": "string"
      }
    }
  },
  "$$ref": "#/components/schemas/ConfigBatchSaveRequest"
}
```

**响应** (raw)

```
OK
```

---

### /inner/system/config/refreshCache

- **接口ID**: 50487
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/system/config/refreshCache`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-01 18:36:03
- **标签**: inner-system-config-controller

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "bizKey": {
      "type": "string"
    },
    "configKey": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/ConfigQueryRequest"
}
```

**响应** (raw)

```
OK
```

---

### /inner/system/config/map

- **接口ID**: 50495
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/system/config/map`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-01 18:36:03
- **标签**: inner-system-config-controller

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "bizKey": {
      "type": "string"
    },
    "configKey": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/ConfigQueryRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "additionalProperties": {
    "type": "string"
  }
}
```

---

### /inner/system/config/list

- **接口ID**: 50503
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/system/config/list`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-01 18:36:03
- **标签**: inner-system-config-controller

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "bizKey": {
      "type": "string"
    },
    "configKey": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/ConfigQueryRequest"
}
```

**响应** (json)

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "bizKey": {
        "type": "string"
      },
      "configKey": {
        "type": "string"
      },
      "configValue": {
        "type": "string"
      },
      "description": {
        "type": "string"
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedBy": {
        "type": "string"
      },
      "enabled": {
        "type": "boolean"
      }
    },
    "$$ref": "#/components/schemas/SystemConfigEntity"
  }
}
```

---

### /inner/system/config/get

- **接口ID**: 50511
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/system/config/get`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-01 18:36:03
- **标签**: inner-system-config-controller

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "bizKey": {
      "type": "string"
    },
    "configKey": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/ConfigQueryRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "bizKey": {
      "type": "string"
    },
    "configKey": {
      "type": "string"
    },
    "configValue": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedBy": {
      "type": "string"
    },
    "enabled": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/SystemConfigEntity"
}
```

---

### /inner/system/config/getValue

- **接口ID**: 50519
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/system/config/getValue`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-01 18:36:03
- **标签**: inner-system-config-controller

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "bizKey": {
      "type": "string"
    },
    "configKey": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/ConfigQueryRequest"
}
```

**响应** (json)

```json
{
  "type": "string"
}
```

---

### /inner/system/config/delete

- **接口ID**: 50527
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/system/config/delete`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-01 18:36:03
- **标签**: inner-system-config-controller

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "bizKey": {
      "type": "string"
    },
    "configKey": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/ConfigQueryRequest"
}
```

**响应** (raw)

```
OK
```

---

### /inner/system/config/deleteAll

- **接口ID**: 50535
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/system/config/deleteAll`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-01 18:36:03
- **标签**: inner-system-config-controller

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "bizKey": {
      "type": "string"
    },
    "configKey": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/ConfigQueryRequest"
}
```

**响应** (raw)

```
OK
```

---

### /inner/system/config/special-user-depts/remove

- **接口ID**: 50559
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/system/config/special-user-depts/remove`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-03 17:12:03
- **标签**: inner-system-config-controller

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "oid": {
      "type": "string"
    },
    "deptId": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/SpecialUserDeptRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "additionalProperties": {
    "type": "array",
    "items": {
      "type": "string"
    }
  }
}
```

---

### /inner/system/config/special-user-depts/list

- **接口ID**: 50567
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/system/config/special-user-depts/list`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-03 17:12:03
- **标签**: inner-system-config-controller

**响应** (json)

```json
{
  "type": "object",
  "additionalProperties": {
    "type": "array",
    "items": {
      "type": "string"
    }
  }
}
```

---

### /inner/system/config/special-user-depts/add

- **接口ID**: 50575
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/system/config/special-user-depts/add`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-03 17:12:03
- **标签**: inner-system-config-controller

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "oid": {
      "type": "string"
    },
    "deptId": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/SpecialUserDeptRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "additionalProperties": {
    "type": "array",
    "items": {
      "type": "string"
    }
  }
}
```

---

### 【内部测试】直传文本流式生成

- **接口ID**: 51063
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/meeting-minutes/inner/test-stream`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-08-06 11:38:03
- **标签**: 会议纪要 v2

**说明**

跳过转写服务查询与回写，直接传转写文本验证管线效果（本地测试页面用）

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string"
    },
    "note": {
      "type": "string"
    },
    "scene": {
      "type": "string"
    }
  },
  "required": [
    "text"
  ],
  "$$ref": "#/components/schemas/TextTestRequest"
}
```

**响应** (raw)

```
OK
```

---

### 流式生成会议纪要（路径 B 正式端点）

- **接口ID**: 51071
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/meeting-minutes/generate-stream`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-08-06 11:38:03
- **标签**: 会议纪要 v2

**说明**

按 transcriptId 走 v2 管线，SSE 推送 9 阶段进度；异常自动降级 v1 并推 fallback 事件

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "transcriptId": {
      "type": "string"
    },
    "forceRefresh": {
      "type": "boolean"
    }
  },
  "required": [
    "transcriptId"
  ],
  "$$ref": "#/components/schemas/GenerateRequest"
}
```

**响应** (raw)

```
OK
```

---

### 查询最近一次成功结果（页面刷新后回显）

- **接口ID**: 51079
- **分类**: 公共分类
- **请求方式**: `GET`
- **路径**: `/workassistant-ai-agent/api/meeting-minutes/result/{transcriptId}`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-08-06 11:38:03
- **标签**: 会议纪要 v2

**说明**

从 meeting_minutes_record 查最近一次 SUCCESS 产物；不存在返回 204（§16 P2）

**路径参数**

| name | desc | example |
|---|---|---|
| transcriptId |  |  |

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "content": {
      "type": "string"
    },
    "contentMd": {
      "type": "string"
    },
    "renderVersion": {
      "type": "string"
    },
    "coreConclusions": {
      "type": "string"
    },
    "discussionPoints": {
      "type": "string"
    },
    "actionItems": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "待办事项",
        "properties": {
          "text": {
            "type": "string",
            "description": "待办内容",
            "example": "完成原型设计"
          },
          "assignee": {
            "type": "string",
            "description": "责任人（如提及）",
            "example": "张三"
          },
          "dueDate": {
            "type": "integer",
            "format": "int64",
            "description": "截止日期（毫秒时间戳）",
            "example": 1720454400000
          }
        },
        "$$ref": "#/components/schemas/ActionItem"
      }
    },
    "minorDecisions": {
      "type": "array",
      "deprecated": true,
      "items": {
        "type": "string",
        "deprecated": true
      }
    },
    "meetingBackground": {
      "type": "string"
    },
    "globalCanvas": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string"
        },
        "subtitle": {
          "type": "string"
        },
        "sections": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "theme": {
                "type": "string"
              },
              "heading": {
                "type": "string"
              },
              "columns": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "heading": {
                      "type": "string"
                    },
                    "tag": {
                      "type": "string"
                    },
                    "bullets": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    }
                  },
                  "$$ref": "#/components/schemas/CanvasColumn"
                }
              }
            },
            "$$ref": "#/components/schemas/CanvasSection"
          }
        },
        "quotes": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "quote": {
                "type": "string"
              },
              "commentary": {
                "type": "string"
              }
            },
            "$$ref": "#/components/schemas/CanvasQuote"
          }
        }
      },
      "$$ref": "#/components/schemas/CanvasSchema"
    },
    "topicBlocks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "heading": {
            "type": "string"
          },
          "level": {
            "type": "integer",
            "format": "int32"
          },
          "bullets": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "$$ref": "#/components/schemas/TopicBlock"
      }
    },
    "highlightMode": {
      "type": "string",
      "enum": [
        "NONE",
        "CORE_SPEECH",
        "GOLDEN_QUOTES"
      ]
    },
    "coreSpeeches": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "speaker": {
            "type": "string"
          },
          "points": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "rawQuote": {
            "type": "string"
          }
        },
        "$$ref": "#/components/schemas/CoreSpeech"
      }
    },
    "decisions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "content": {
            "type": "string"
          },
          "basis": {
            "type": "string"
          },
          "owner": {
            "type": "string"
          }
        },
        "$$ref": "#/components/schemas/DecisionItem"
      }
    },
    "normalized": {
      "type": "boolean"
    },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "页面分区",
        "properties": {
          "title": {
            "type": "string",
            "description": "分区标题"
          },
          "content": {
            "type": "string",
            "description": "段落正文"
          },
          "items": {
            "type": "array",
            "description": "列表项",
            "items": {
              "type": "string"
            }
          }
        },
        "$$ref": "#/components/schemas/Section"
      }
    },
    "summaryTree": {
      "type": "object",
      "properties": {
        "overview": {
          "type": "string"
        },
        "topics": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "title": {
                "type": "string"
              },
              "subtopics": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "title": {
                      "type": "string"
                    },
                    "points": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    }
                  },
                  "$$ref": "#/components/schemas/Subtopic"
                }
              }
            },
            "$$ref": "#/components/schemas/Topic"
          }
        }
      },
      "$$ref": "#/components/schemas/SummaryTree"
    },
    "infoCards": {
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
          "items": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "label": {
                  "type": "string"
                },
                "text": {
                  "type": "string"
                }
              },
              "$$ref": "#/components/schemas/Item"
            }
          }
        },
        "$$ref": "#/components/schemas/InfoCard"
      }
    },
    "overview": {
      "type": "string"
    },
    "durationMinutes": {
      "type": "integer",
      "format": "int32"
    },
    "recordTime": {
      "type": "integer",
      "format": "int64"
    },
    "audit": {
      "type": "object",
      "properties": {
        "issues": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "code": {
                "type": "string"
              },
              "level": {
                "type": "string"
              },
              "message": {
                "type": "string"
              },
              "ref": {
                "type": "string"
              }
            },
            "$$ref": "#/components/schemas/Issue"
          }
        },
        "hasError": {
          "type": "boolean"
        },
        "hasWarning": {
          "type": "boolean"
        },
        "verifiedAtoms": {
          "type": "integer",
          "format": "int64"
        },
        "blockedAtoms": {
          "type": "integer",
          "format": "int64"
        }
      },
      "$$ref": "#/components/schemas/AuditReport"
    },
    "sceneType": {
      "type": "string"
    },
    "speakerStats": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "speaker": {
            "type": "string"
          },
          "turns": {
            "type": "integer",
            "format": "int32"
          },
          "chars": {
            "type": "integer",
            "format": "int64"
          },
          "percent": {
            "type": "number",
            "format": "double"
          },
          "firstMs": {
            "type": "integer",
            "format": "int64"
          },
          "lastMs": {
            "type": "integer",
            "format": "int64"
          }
        },
        "$$ref": "#/components/schemas/SpeakerStat"
      }
    },
    "generatorVersion": {
      "type": "string"
    },
    "cacheHit": {
      "type": "boolean"
    },
    "fallback": {
      "type": "boolean"
    },
    "elapsedMs": {
      "type": "integer",
      "format": "int64"
    }
  },
  "$$ref": "#/components/schemas/MinutesOutput"
}
```

---

### 查询最近一次成功结果（页面刷新后回显）

- **接口ID**: 51087
- **分类**: 公共分类
- **请求方式**: `GET`
- **路径**: `/workassistant-ai-agent/api/meeting-minutes/result/{stenoId}`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-08-06 13:04:07
- **标签**: 会议纪要 v2

**说明**

从 meeting_minutes_record 查最近一次 SUCCESS 产物；不存在返回 204（§16 P2）

**路径参数**

| name | desc | example |
|---|---|---|
| stenoId |  |  |

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "content": {
      "type": "string"
    },
    "contentMd": {
      "type": "string"
    },
    "renderVersion": {
      "type": "string"
    },
    "coreConclusions": {
      "type": "string"
    },
    "discussionPoints": {
      "type": "string"
    },
    "actionItems": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "待办事项",
        "properties": {
          "text": {
            "type": "string",
            "description": "待办内容",
            "example": "完成原型设计"
          },
          "assignee": {
            "type": "string",
            "description": "责任人（如提及）",
            "example": "张三"
          },
          "dueDate": {
            "type": "integer",
            "format": "int64",
            "description": "截止日期（毫秒时间戳）",
            "example": 1720454400000
          }
        },
        "$$ref": "#/components/schemas/ActionItem"
      }
    },
    "minorDecisions": {
      "type": "array",
      "deprecated": true,
      "items": {
        "type": "string",
        "deprecated": true
      }
    },
    "meetingBackground": {
      "type": "string"
    },
    "globalCanvas": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string"
        },
        "subtitle": {
          "type": "string"
        },
        "sections": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "theme": {
                "type": "string"
              },
              "heading": {
                "type": "string"
              },
              "columns": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "heading": {
                      "type": "string"
                    },
                    "tag": {
                      "type": "string"
                    },
                    "bullets": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    }
                  },
                  "$$ref": "#/components/schemas/CanvasColumn"
                }
              }
            },
            "$$ref": "#/components/schemas/CanvasSection"
          }
        },
        "quotes": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "quote": {
                "type": "string"
              },
              "commentary": {
                "type": "string"
              }
            },
            "$$ref": "#/components/schemas/CanvasQuote"
          }
        }
      },
      "$$ref": "#/components/schemas/CanvasSchema"
    },
    "topicBlocks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "heading": {
            "type": "string"
          },
          "level": {
            "type": "integer",
            "format": "int32"
          },
          "bullets": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "$$ref": "#/components/schemas/TopicBlock"
      }
    },
    "highlightMode": {
      "type": "string",
      "enum": [
        "NONE",
        "CORE_SPEECH",
        "GOLDEN_QUOTES"
      ]
    },
    "coreSpeeches": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "speaker": {
            "type": "string"
          },
          "points": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "rawQuote": {
            "type": "string"
          }
        },
        "$$ref": "#/components/schemas/CoreSpeech"
      }
    },
    "decisions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "content": {
            "type": "string"
          },
          "basis": {
            "type": "string"
          },
          "owner": {
            "type": "string"
          }
        },
        "$$ref": "#/components/schemas/DecisionItem"
      }
    },
    "normalized": {
      "type": "boolean"
    },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "页面分区",
        "properties": {
          "title": {
            "type": "string",
            "description": "分区标题"
          },
          "content": {
            "type": "string",
            "description": "段落正文"
          },
          "items": {
            "type": "array",
            "description": "列表项",
            "items": {
              "type": "string"
            }
          }
        },
        "$$ref": "#/components/schemas/Section"
      }
    },
    "summaryTree": {
      "type": "object",
      "properties": {
        "overview": {
          "type": "string"
        },
        "topics": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "title": {
                "type": "string"
              },
              "subtopics": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "title": {
                      "type": "string"
                    },
                    "points": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    }
                  },
                  "$$ref": "#/components/schemas/Subtopic"
                }
              }
            },
            "$$ref": "#/components/schemas/Topic"
          }
        }
      },
      "$$ref": "#/components/schemas/SummaryTree"
    },
    "infoCards": {
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
          "items": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "label": {
                  "type": "string"
                },
                "text": {
                  "type": "string"
                }
              },
              "$$ref": "#/components/schemas/Item"
            }
          }
        },
        "$$ref": "#/components/schemas/InfoCard"
      }
    },
    "overview": {
      "type": "string"
    },
    "durationMinutes": {
      "type": "integer",
      "format": "int32"
    },
    "recordTime": {
      "type": "integer",
      "format": "int64"
    },
    "audit": {
      "type": "object",
      "properties": {
        "issues": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "code": {
                "type": "string"
              },
              "level": {
                "type": "string"
              },
              "message": {
                "type": "string"
              },
              "ref": {
                "type": "string"
              }
            },
            "$$ref": "#/components/schemas/Issue"
          }
        },
        "hasError": {
          "type": "boolean"
        },
        "hasWarning": {
          "type": "boolean"
        },
        "verifiedAtoms": {
          "type": "integer",
          "format": "int64"
        },
        "blockedAtoms": {
          "type": "integer",
          "format": "int64"
        }
      },
      "$$ref": "#/components/schemas/AuditReport"
    },
    "sceneType": {
      "type": "string"
    },
    "speakerStats": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "speaker": {
            "type": "string"
          },
          "turns": {
            "type": "integer",
            "format": "int32"
          },
          "chars": {
            "type": "integer",
            "format": "int64"
          },
          "percent": {
            "type": "number",
            "format": "double"
          },
          "firstMs": {
            "type": "integer",
            "format": "int64"
          },
          "lastMs": {
            "type": "integer",
            "format": "int64"
          }
        },
        "$$ref": "#/components/schemas/SpeakerStat"
      }
    },
    "generatorVersion": {
      "type": "string"
    },
    "cacheHit": {
      "type": "boolean"
    },
    "fallback": {
      "type": "boolean"
    },
    "elapsedMs": {
      "type": "integer",
      "format": "int64"
    }
  },
  "$$ref": "#/components/schemas/MinutesOutput"
}
```

---

## 会议测试 (1)

- [触发会议纪要生成](#触发会议纪要生成--workassistant-ai-agent-api-meeting-test-gensummary) `POST`

### 触发会议纪要生成

- **接口ID**: 49322
- **分类**: 会议测试
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/meeting/test/genSummary`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:20
- **标签**: 会议测试

**说明**

测试接口：模拟会议纪要完成事件，触发后续处理流程

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| meetingId |  | 会议ID |  |

**响应** (raw)

```
OK
```

---

## 日历冲突管理 (13)

- [执行会议压缩策略](#执行会议压缩策略--workassistant-ai-agent-api-calendar-conflict-shorten) `POST`
- [执行会议改期策略](#执行会议改期策略--workassistant-ai-agent-api-calendar-conflict-reschedule) `POST`
- [检测日历冲突](#检测日历冲突--workassistant-ai-agent-api-calendar-conflict-detect) `POST`
- [执行会议委派策略](#执行会议委派策略--workassistant-ai-agent-api-calendar-conflict-delegate) `POST`
- [获取可用时间](#获取可用时间--workassistant-ai-agent-api-calendar-conflict-available-time) `POST`
- [执行委托参会策略](#执行委托参会策略--workassistant-ai-agent-api-calendar-conflict-entrustjoin) `POST`
- [流式检测日历冲突](#流式检测日历冲突--workassistant-ai-agent-api-calendar-conflict-detect-stream) `POST`
- [校验参会人时间冲突并推荐时间](#校验参会人时间冲突并推荐时间--workassistant-ai-agent-api-calendar-conflict-participant-availability) `POST`
- [AI 智能推荐时段-流式](#ai-智能推荐时段-流式--workassistant-ai-agent-api-calendar-conflict-participant-availability-stream) `POST`
- [规则推荐时段](#规则推荐时段--workassistant-ai-agent-api-calendar-conflict-participant-availability-rule) `POST`
- [检测日历冲突-规则版](#检测日历冲突-规则版--workassistant-ai-agent-api-calendar-conflict-detect-rule) `POST`
- [检测日历冲突摘要](#检测日历冲突摘要--workassistant-ai-agent-api-calendar-conflict-detect-summary) `POST`
- [检测日历冲突摘要](#检测日历冲突摘要--workassistant-ai-agent-api-calendar-conflict-detect-summary) `GET`

### 执行会议压缩策略

- **接口ID**: 49334
- **分类**: 日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/calendar/conflict/shorten`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:20
- **标签**: 日历冲突管理

**说明**

通过缩短会议时长来解决冲突

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "压缩请求",
  "properties": {
    "conflictId": {
      "type": "string",
      "description": "冲突ID",
      "example": "conflict-123"
    },
    "meetingId": {
      "type": "string",
      "description": "要调整的会议ID",
      "example": "meeting-456"
    },
    "adjustType": {
      "type": "string",
      "description": "调整类型",
      "enum": [
        "END_EARLY",
        "START_LATE"
      ],
      "example": "END_EARLY"
    },
    "newEndTime": {
      "type": "string",
      "description": "新的结束时间（adjustType=END_EARLY时必填）",
      "example": "2026-03-04T10:00:00"
    },
    "newStartTime": {
      "type": "string",
      "description": "新的开始时间（adjustType=START_LATE时必填）",
      "example": "2026-03-04T11:00:00"
    }
  },
  "required": [
    "adjustType",
    "conflictId",
    "meetingId"
  ],
  "$$ref": "#/components/schemas/ShortenRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "会议压缩策略响应",
  "properties": {
    "success": {
      "type": "boolean",
      "description": "是否成功",
      "example": true
    },
    "meetingId": {
      "type": "string",
      "description": "会议ID",
      "example": "meeting-456"
    },
    "message": {
      "type": "string",
      "description": "结果消息",
      "example": "会议时间已调整"
    }
  },
  "$$ref": "#/components/schemas/ShortenResponse"
}
```

---

### 执行会议改期策略

- **接口ID**: 49338
- **分类**: 日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/calendar/conflict/reschedule`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:20
- **标签**: 日历冲突管理

**说明**

通过更改会议时间来解决冲突

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "改期请求",
  "properties": {
    "conflictId": {
      "type": "string",
      "description": "冲突ID",
      "example": "conflict-123"
    },
    "meetingId": {
      "type": "string",
      "description": "要改期的会议ID",
      "example": "meeting-456"
    },
    "newStartTime": {
      "type": "string",
      "format": "date-time",
      "description": "新的开始时间",
      "example": "2026-03-04T14:00:00"
    },
    "newEndTime": {
      "type": "string",
      "format": "date-time",
      "description": "新的结束时间",
      "example": "2026-03-04T15:00:00"
    }
  },
  "required": [
    "conflictId",
    "meetingId",
    "newEndTime",
    "newStartTime"
  ],
  "$$ref": "#/components/schemas/RescheduleRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "success": {
      "type": "boolean"
    },
    "meetingId": {
      "type": "string"
    },
    "newStartTime": {
      "type": "string",
      "format": "date-time"
    },
    "newEndTime": {
      "type": "string",
      "format": "date-time"
    },
    "message": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/RescheduleResponse"
}
```

---

### 检测日历冲突

- **接口ID**: 49342
- **分类**: 日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/calendar/conflict/detect`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:20
- **标签**: 日历冲突管理

**说明**

检测指定时间范围内的日历冲突，并返回可能的解决策略

**响应** (json)

```json
{
  "type": "object",
  "description": "冲突检测响应",
  "properties": {
    "hasConflict": {
      "type": "boolean",
      "description": "是否存在冲突",
      "example": true
    },
    "conflicts": {
      "type": "array",
      "description": "冲突列表",
      "items": {
        "type": "object",
        "properties": {
          "conflictId": {
            "type": "string"
          },
          "conflictTime": {
            "type": "object",
            "properties": {
              "startTime": {
                "type": "string",
                "format": "date-time"
              },
              "endTime": {
                "type": "string",
                "format": "date-time"
              }
            },
            "$$ref": "#/components/schemas/TimeRange"
          },
          "meetings": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "meetingId": {
                  "type": "string"
                },
                "title": {
                  "type": "string"
                },
                "content": {
                  "type": "string"
                },
                "meetingPlace": {
                  "type": "string"
                },
                "startTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "endTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "createTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "openId": {
                  "type": "string"
                },
                "userId": {
                  "type": "string"
                },
                "personName": {
                  "type": "string"
                },
                "photoUrl": {
                  "type": "string"
                },
                "department": {
                  "type": "string"
                },
                "workStatus": {
                  "type": "integer",
                  "format": "int32"
                },
                "workSource": {
                  "type": "string"
                },
                "repeat": {
                  "type": "integer",
                  "format": "int32"
                },
                "repeatEndTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "batchId": {
                  "type": "string"
                },
                "roomId": {
                  "type": "string"
                },
                "roomOrderId": {
                  "type": "string"
                },
                "noticeTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "noticeTimes": {
                  "type": "string"
                },
                "calendarId": {
                  "type": "string"
                },
                "calendarName": {
                  "type": "string"
                },
                "calendarAdmin": {
                  "type": "boolean"
                },
                "participantIds": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "groupId": {
                  "type": "string"
                },
                "networkName": {
                  "type": "string"
                },
                "meetingCategory": {
                  "type": "integer",
                  "format": "int32"
                },
                "canEdit": {
                  "type": "boolean"
                },
                "remarks": {
                  "type": "string"
                },
                "cancelTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "cancelReason": {
                  "type": "string"
                },
                "source": {
                  "type": "string"
                },
                "priority": {
                  "type": "string",
                  "enum": [
                    "HIGH",
                    "NORMAL"
                  ]
                },
                "priorityReason": {
                  "type": "string"
                },
                "participantCount": {
                  "type": "integer",
                  "format": "int32"
                }
              },
              "$$ref": "#/components/schemas/MeetingInfo"
            }
          },
          "strategy": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "SHORTEN",
                  "DELEGATE",
                  "RESCHEDULE",
                  "NONE"
                ]
              },
              "reason": {
                "type": "string"
              },
              "targetMeetingId": {
                "type": "string"
              },
              "targetMeetingTitle": {
                "type": "string"
              },
              "overlapMinutes": {
                "type": "integer",
                "format": "int32"
              }
            },
            "$$ref": "#/components/schemas/ResolveStrategy"
          }
        },
        "$$ref": "#/components/schemas/ConflictInfo"
      }
    },
    "schedules": {
      "type": "array",
      "description": "用户日程列表（用于计算空闲时间）",
      "items": {
        "type": "object",
        "properties": {
          "meetingId": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "content": {
            "type": "string"
          },
          "meetingPlace": {
            "type": "string"
          },
          "startTime": {
            "type": "string",
            "format": "date-time"
          },
          "endTime": {
            "type": "string",
            "format": "date-time"
          },
          "createTime": {
            "type": "string",
            "format": "date-time"
          },
          "openId": {
            "type": "string"
          },
          "userId": {
            "type": "string"
          },
          "personName": {
            "type": "string"
          },
          "photoUrl": {
            "type": "string"
          },
          "department": {
            "type": "string"
          },
          "workStatus": {
            "type": "integer",
            "format": "int32"
          },
          "workSource": {
            "type": "string"
          },
          "repeat": {
            "type": "integer",
            "format": "int32"
          },
          "repeatEndTime": {
            "type": "string",
            "format": "date-time"
          },
          "batchId": {
            "type": "string"
          },
          "roomId": {
            "type": "string"
          },
          "roomOrderId": {
            "type": "string"
          },
          "noticeTime": {
            "type": "string",
            "format": "date-time"
          },
          "noticeTimes": {
            "type": "string"
          },
          "calendarId": {
            "type": "string"
          },
          "calendarName": {
            "type": "string"
          },
          "calendarAdmin": {
            "type": "boolean"
          },
          "participantIds": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "groupId": {
            "type": "string"
          },
          "networkName": {
            "type": "string"
          },
          "meetingCategory": {
            "type": "integer",
            "format": "int32"
          },
          "canEdit": {
            "type": "boolean"
          },
          "remarks": {
            "type": "string"
          },
          "cancelTime": {
            "type": "string",
            "format": "date-time"
          },
          "cancelReason": {
            "type": "string"
          },
          "source": {
            "type": "string"
          },
          "priority": {
            "type": "string",
            "enum": [
              "HIGH",
              "NORMAL"
            ]
          },
          "priorityReason": {
            "type": "string"
          },
          "participantCount": {
            "type": "integer",
            "format": "int32"
          }
        },
        "$$ref": "#/components/schemas/MeetingInfo"
      }
    }
  },
  "$$ref": "#/components/schemas/ConflictDetectResponse"
}
```

---

### 执行会议委派策略

- **接口ID**: 49346
- **分类**: 日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/calendar/conflict/delegate`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:20
- **标签**: 日历冲突管理

**说明**

将会议委派给其他参与者来解决冲突

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "委派请求",
  "properties": {
    "conflictId": {
      "type": "string",
      "description": "冲突ID",
      "example": "conflict-123"
    },
    "meetingId": {
      "type": "string",
      "description": "要委派的会议ID",
      "example": "meeting-456"
    },
    "newHostId": {
      "type": "string",
      "description": "新负责人ID",
      "example": "user-789"
    },
    "newHostName": {
      "type": "string",
      "description": "新负责人姓名",
      "example": "张三"
    }
  },
  "required": [
    "conflictId",
    "meetingId",
    "newHostId",
    "newHostName"
  ],
  "$$ref": "#/components/schemas/DelegateRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "success": {
      "type": "boolean"
    },
    "meetingId": {
      "type": "string"
    },
    "newHostName": {
      "type": "string"
    },
    "message": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/DelegateResponse"
}
```

---

### 获取可用时间

- **接口ID**: 49350
- **分类**: 日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/calendar/conflict/available-time`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:20
- **标签**: 日历冲突管理

**说明**

查找指定时间范围内的可用时间段，用于会议改期参考

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "可用时间查找请求",
  "properties": {
    "oid": {
      "type": "string",
      "description": "用户OID",
      "example": "oid-123"
    },
    "meetingDuration": {
      "type": "integer",
      "format": "int32",
      "description": "会议时长（分钟）",
      "example": 60,
      "minimum": 1
    },
    "afterTime": {
      "type": "string",
      "format": "date-time",
      "description": "从该时间之后开始查找",
      "example": "2026-03-04T09:00:00"
    },
    "schedules": {
      "type": "array",
      "description": "用户的日程列表（用于排除冲突）",
      "items": {
        "type": "object",
        "properties": {
          "meetingId": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "content": {
            "type": "string"
          },
          "meetingPlace": {
            "type": "string"
          },
          "startTime": {
            "type": "string",
            "format": "date-time"
          },
          "endTime": {
            "type": "string",
            "format": "date-time"
          },
          "createTime": {
            "type": "string",
            "format": "date-time"
          },
          "openId": {
            "type": "string"
          },
          "userId": {
            "type": "string"
          },
          "personName": {
            "type": "string"
          },
          "photoUrl": {
            "type": "string"
          },
          "department": {
            "type": "string"
          },
          "workStatus": {
            "type": "integer",
            "format": "int32"
          },
          "workSource": {
            "type": "string"
          },
          "repeat": {
            "type": "integer",
            "format": "int32"
          },
          "repeatEndTime": {
            "type": "string",
            "format": "date-time"
          },
          "batchId": {
            "type": "string"
          },
          "roomId": {
            "type": "string"
          },
          "roomOrderId": {
            "type": "string"
          },
          "noticeTime": {
            "type": "string",
            "format": "date-time"
          },
          "noticeTimes": {
            "type": "string"
          },
          "calendarId": {
            "type": "string"
          },
          "calendarName": {
            "type": "string"
          },
          "calendarAdmin": {
            "type": "boolean"
          },
          "participantIds": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "groupId": {
            "type": "string"
          },
          "networkName": {
            "type": "string"
          },
          "meetingCategory": {
            "type": "integer",
            "format": "int32"
          },
          "canEdit": {
            "type": "boolean"
          },
          "remarks": {
            "type": "string"
          },
          "cancelTime": {
            "type": "string",
            "format": "date-time"
          },
          "cancelReason": {
            "type": "string"
          },
          "source": {
            "type": "string"
          },
          "priority": {
            "type": "string",
            "enum": [
              "HIGH",
              "NORMAL"
            ]
          },
          "priorityReason": {
            "type": "string"
          },
          "participantCount": {
            "type": "integer",
            "format": "int32"
          }
        },
        "$$ref": "#/components/schemas/MeetingInfo"
      }
    }
  },
  "required": [
    "afterTime",
    "meetingDuration",
    "oid",
    "schedules"
  ],
  "$$ref": "#/components/schemas/AvailableTimeRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "recommendedSlots": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "startTime": {
            "type": "string",
            "format": "date-time"
          },
          "endTime": {
            "type": "string",
            "format": "date-time"
          },
          "score": {
            "type": "integer",
            "format": "int32"
          },
          "reason": {
            "type": "string"
          }
        },
        "$$ref": "#/components/schemas/AvailableTimeSlot"
      }
    }
  },
  "$$ref": "#/components/schemas/AvailableTimeResponse"
}
```

---

### 执行委托参会策略

- **接口ID**: 49486
- **分类**: 日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/calendar/conflict/entrustJoin`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-11 17:54:02
- **标签**: 日历冲突管理

**说明**

将会议委托给其他同事代为参会来解决冲突

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "委托参会请求",
  "properties": {
    "conflictId": {
      "type": "string",
      "description": "冲突ID",
      "example": "conflict-123"
    },
    "meetingId": {
      "type": "string",
      "description": "要委托的会议ID",
      "example": "meeting-456"
    },
    "mandataryOids": {
      "type": "array",
      "description": "被委托参会人的OID列表",
      "items": {
        "type": "string"
      }
    },
    "mandataryNames": {
      "type": "array",
      "description": "被委托参会人的姓名列表",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "conflictId",
    "mandataryOids",
    "meetingId"
  ],
  "$$ref": "#/components/schemas/EntrustJoinRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "success": {
      "type": "boolean"
    },
    "meetingId": {
      "type": "string"
    },
    "mandataryOids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "message": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/EntrustJoinResponse"
}
```

---

### 流式检测日历冲突

- **接口ID**: 49490
- **分类**: 日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/calendar/conflict/detect-stream`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-11 19:00:02
- **标签**: 日历冲突管理

**说明**

通过 SSE 流式返回冲突检测进度与逐组冲突结果，不影响原有 detect 接口

**响应** (raw)

```
OK
```

---

### 校验参会人时间冲突并推荐时间

- **接口ID**: 49530
- **分类**: 日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/calendar/conflict/participant-availability`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-13 09:34:02
- **标签**: 日历冲突管理

**说明**

返回所选参会人今明两天的占用时段，标记原会议时段的冲突用户，并给出推荐候选时间

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "参会人冲突校验请求",
  "properties": {
    "meetingId": {
      "type": "string",
      "description": "会议ID，编辑会议时传入以排除自身",
      "example": "meeting-123"
    },
    "startTime": {
      "type": "string",
      "format": "date-time",
      "description": "会议开始时间",
      "example": "2026-03-12T10:00:00"
    },
    "endTime": {
      "type": "string",
      "format": "date-time",
      "description": "会议结束时间",
      "example": "2026-03-12T11:00:00"
    },
    "participantOids": {
      "type": "array",
      "description": "参会人OID列表",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "endTime",
    "participantOids",
    "startTime"
  ],
  "$$ref": "#/components/schemas/ParticipantAvailabilityRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "occupiedRangeStartTime": {
      "type": "string",
      "format": "date-time"
    },
    "occupiedRangeEndTime": {
      "type": "string",
      "format": "date-time"
    },
    "hasConflict": {
      "type": "boolean"
    },
    "conflictParticipantOids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "participants": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "oid": {
            "type": "string"
          },
          "conflict": {
            "type": "boolean"
          },
          "conflictItems": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string"
                },
                "type": {
                  "type": "string"
                },
                "title": {
                  "type": "string"
                },
                "status": {
                  "type": "integer",
                  "format": "int32"
                },
                "startTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "endTime": {
                  "type": "string",
                  "format": "date-time"
                }
              },
              "$$ref": "#/components/schemas/ParticipantConflictItem"
            }
          }
        },
        "$$ref": "#/components/schemas/ParticipantConflictUser"
      }
    },
    "recommendedSlots": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "startTime": {
            "type": "string",
            "format": "date-time"
          },
          "endTime": {
            "type": "string",
            "format": "date-time"
          },
          "allAvailable": {
            "type": "boolean"
          },
          "availableParticipantCount": {
            "type": "integer",
            "format": "int32"
          },
          "conflictParticipantCount": {
            "type": "integer",
            "format": "int32"
          },
          "availableParticipantOids": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "conflictParticipantOids": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "score": {
            "type": "integer",
            "format": "int32"
          },
          "reason": {
            "type": "string"
          }
        },
        "$$ref": "#/components/schemas/ParticipantAvailabilitySlot"
      }
    },
    "recommendationSummary": {
      "type": "string"
    }
  },
  "$$ref": "#/components/schemas/ParticipantAvailabilityResponse"
}
```

---

### AI 智能推荐时段-流式

- **接口ID**: 49534
- **分类**: 日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/calendar/conflict/participant-availability-stream`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-13 14:18:01
- **标签**: 日历冲突管理

**说明**

流式返回参会人占用块查询和 AI 推荐时段过程

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "参会人冲突校验请求",
  "properties": {
    "meetingId": {
      "type": "string",
      "description": "会议ID，编辑会议时传入以排除自身",
      "example": "meeting-123"
    },
    "startTime": {
      "type": "string",
      "format": "date-time",
      "description": "会议开始时间",
      "example": "2026-03-12T10:00:00"
    },
    "endTime": {
      "type": "string",
      "format": "date-time",
      "description": "会议结束时间",
      "example": "2026-03-12T11:00:00"
    },
    "participantOids": {
      "type": "array",
      "description": "参会人OID列表",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "endTime",
    "participantOids",
    "startTime"
  ],
  "$$ref": "#/components/schemas/ParticipantAvailabilityRequest"
}
```

**响应** (raw)

```
OK
```

---

### 规则推荐时段

- **接口ID**: 49600
- **分类**: 日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/calendar/conflict/participant-availability-rule`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-26 13:54:02
- **标签**: 日历冲突管理

**说明**

基于参会人忙闲情况，完全按规则返回候选时段列表

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "参会人冲突校验请求",
  "properties": {
    "meetingId": {
      "type": "string",
      "description": "会议ID，编辑会议时传入以排除自身",
      "example": "meeting-123"
    },
    "startTime": {
      "type": "string",
      "format": "date-time",
      "description": "会议开始时间",
      "example": "2026-03-12T10:00:00"
    },
    "endTime": {
      "type": "string",
      "format": "date-time",
      "description": "会议结束时间",
      "example": "2026-03-12T11:00:00"
    },
    "participantOids": {
      "type": "array",
      "description": "参会人OID列表",
      "items": {
        "type": "string"
      }
    },
    "timeZone": {
      "type": "string",
      "description": "请求时间所属时区，使用 IANA 时区 ID；不传时默认服务端系统时区",
      "example": "Asia/Shanghai"
    }
  },
  "required": [
    "endTime",
    "participantOids",
    "startTime"
  ],
  "$$ref": "#/components/schemas/ParticipantAvailabilityRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "recommendedSlots": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "startTime": {
            "type": "string",
            "format": "date-time"
          },
          "endTime": {
            "type": "string",
            "format": "date-time"
          },
          "allAvailable": {
            "type": "boolean"
          },
          "availableParticipantCount": {
            "type": "integer",
            "format": "int32"
          },
          "conflictParticipantCount": {
            "type": "integer",
            "format": "int32"
          },
          "availableParticipantOids": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "conflictParticipantOids": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "tag": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          }
        },
        "$$ref": "#/components/schemas/ParticipantAvailabilitySlot"
      }
    }
  },
  "$$ref": "#/components/schemas/ParticipantAvailabilityResponse"
}
```

---

### 检测日历冲突-规则版

- **接口ID**: 49601
- **分类**: 日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/calendar/conflict/detect-rule`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-26 13:54:03
- **标签**: 日历冲突管理

**说明**

不依赖 AI，完全基于规则检测指定时间范围内的日历冲突，并返回解决策略

**响应** (json)

```json
{
  "type": "object",
  "description": "冲突检测响应",
  "properties": {
    "hasConflict": {
      "type": "boolean",
      "description": "是否存在冲突",
      "example": true
    },
    "conflicts": {
      "type": "array",
      "description": "冲突列表",
      "items": {
        "type": "object",
        "properties": {
          "conflictId": {
            "type": "string"
          },
          "conflictTime": {
            "type": "object",
            "properties": {
              "startTime": {
                "type": "string",
                "format": "date-time"
              },
              "endTime": {
                "type": "string",
                "format": "date-time"
              }
            },
            "$$ref": "#/components/schemas/TimeRange"
          },
          "meetings": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "meetingId": {
                  "type": "string"
                },
                "title": {
                  "type": "string"
                },
                "content": {
                  "type": "string"
                },
                "meetingPlace": {
                  "type": "string"
                },
                "startTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "endTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "createTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "openId": {
                  "type": "string"
                },
                "userId": {
                  "type": "string"
                },
                "personName": {
                  "type": "string"
                },
                "photoUrl": {
                  "type": "string"
                },
                "department": {
                  "type": "string"
                },
                "workStatus": {
                  "type": "string",
                  "enum": [
                    "0",
                    "1",
                    "2",
                    "3",
                    "4",
                    "-1"
                  ]
                },
                "workSource": {
                  "type": "string"
                },
                "repeat": {
                  "type": "integer",
                  "format": "int32"
                },
                "repeatEndTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "batchId": {
                  "type": "string"
                },
                "roomId": {
                  "type": "string"
                },
                "roomOrderId": {
                  "type": "string"
                },
                "noticeTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "noticeTimes": {
                  "type": "string"
                },
                "calendarId": {
                  "type": "string"
                },
                "calendarName": {
                  "type": "string"
                },
                "calendarAdmin": {
                  "type": "boolean"
                },
                "participantIds": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "groupId": {
                  "type": "string"
                },
                "networkName": {
                  "type": "string"
                },
                "meetingCategory": {
                  "type": "integer",
                  "format": "int32"
                },
                "canEdit": {
                  "type": "boolean"
                },
                "owner": {
                  "type": "boolean"
                },
                "remarks": {
                  "type": "string"
                },
                "cancelTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "cancelReason": {
                  "type": "string"
                },
                "source": {
                  "type": "string"
                },
                "priority": {
                  "type": "string",
                  "enum": [
                    "HIGH",
                    "NORMAL"
                  ]
                },
                "strategy": {
                  "type": "object",
                  "properties": {
                    "type": {
                      "type": "string",
                      "enum": [
                        "SHORTEN",
                        "DELEGATE",
                        "RESCHEDULE",
                        "NONE"
                      ]
                    },
                    "reason": {
                      "type": "string"
                    },
                    "targetMeetingId": {
                      "type": "string"
                    },
                    "targetMeetingTitle": {
                      "type": "string"
                    },
                    "conflictMeetingId": {
                      "type": "string"
                    },
                    "overlapMinutes": {
                      "type": "integer",
                      "format": "int32"
                    }
                  },
                  "$$ref": "#/components/schemas/ResolveStrategy"
                },
                "conflictDisplayText": {
                  "type": "string"
                },
                "priorityReason": {
                  "type": "string"
                },
                "participantCount": {
                  "type": "integer",
                  "format": "int32"
                }
              },
              "$$ref": "#/components/schemas/MeetingInfo"
            }
          }
        },
        "$$ref": "#/components/schemas/ConflictInfo"
      }
    },
    "schedules": {
      "type": "array",
      "description": "用户日程列表（用于计算空闲时间）",
      "items": {
        "type": "object",
        "properties": {
          "meetingId": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "content": {
            "type": "string"
          },
          "meetingPlace": {
            "type": "string"
          },
          "startTime": {
            "type": "string",
            "format": "date-time"
          },
          "endTime": {
            "type": "string",
            "format": "date-time"
          },
          "createTime": {
            "type": "string",
            "format": "date-time"
          },
          "openId": {
            "type": "string"
          },
          "userId": {
            "type": "string"
          },
          "personName": {
            "type": "string"
          },
          "photoUrl": {
            "type": "string"
          },
          "department": {
            "type": "string"
          },
          "workStatus": {
            "type": "string",
            "enum": [
              "0",
              "1",
              "2",
              "3",
              "4",
              "-1"
            ]
          },
          "workSource": {
            "type": "string"
          },
          "repeat": {
            "type": "integer",
            "format": "int32"
          },
          "repeatEndTime": {
            "type": "string",
            "format": "date-time"
          },
          "batchId": {
            "type": "string"
          },
          "roomId": {
            "type": "string"
          },
          "roomOrderId": {
            "type": "string"
          },
          "noticeTime": {
            "type": "string",
            "format": "date-time"
          },
          "noticeTimes": {
            "type": "string"
          },
          "calendarId": {
            "type": "string"
          },
          "calendarName": {
            "type": "string"
          },
          "calendarAdmin": {
            "type": "boolean"
          },
          "participantIds": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "groupId": {
            "type": "string"
          },
          "networkName": {
            "type": "string"
          },
          "meetingCategory": {
            "type": "integer",
            "format": "int32"
          },
          "canEdit": {
            "type": "boolean"
          },
          "owner": {
            "type": "boolean"
          },
          "remarks": {
            "type": "string"
          },
          "cancelTime": {
            "type": "string",
            "format": "date-time"
          },
          "cancelReason": {
            "type": "string"
          },
          "source": {
            "type": "string"
          },
          "priority": {
            "type": "string",
            "enum": [
              "HIGH",
              "NORMAL"
            ]
          },
          "strategy": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "SHORTEN",
                  "DELEGATE",
                  "RESCHEDULE",
                  "NONE"
                ]
              },
              "reason": {
                "type": "string"
              },
              "targetMeetingId": {
                "type": "string"
              },
              "targetMeetingTitle": {
                "type": "string"
              },
              "conflictMeetingId": {
                "type": "string"
              },
              "overlapMinutes": {
                "type": "integer",
                "format": "int32"
              }
            },
            "$$ref": "#/components/schemas/ResolveStrategy"
          },
          "conflictDisplayText": {
            "type": "string"
          },
          "priorityReason": {
            "type": "string"
          },
          "participantCount": {
            "type": "integer",
            "format": "int32"
          }
        },
        "$$ref": "#/components/schemas/MeetingInfo"
      }
    }
  },
  "$$ref": "#/components/schemas/ConflictDetectResponse"
}
```

---

### 检测日历冲突摘要

- **接口ID**: 49904
- **分类**: 日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/calendar/conflict/detect-summary`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-05-09 11:16:03
- **标签**: 日历冲突管理

**说明**

检测当天日历冲突，并返回前端可直接展示的冲突提示文案

**响应** (json)

```json
{
  "type": "object",
  "description": "冲突提示摘要响应",
  "properties": {
    "hasConflict": {
      "type": "boolean",
      "description": "是否存在冲突",
      "example": true
    },
    "conflictCount": {
      "type": "integer",
      "format": "int32",
      "description": "冲突组数量",
      "example": 1
    },
    "title": {
      "type": "string",
      "description": "提示标题",
      "example": "检测到1处时间冲突"
    },
    "content": {
      "type": "string",
      "description": "提示内容",
      "example": "建议《周会》提前结束15分钟"
    },
    "summaryText": {
      "type": "string",
      "description": "前端可直接展示的完整文案",
      "example": "检测到1处时间冲突，建议《周会》提前结束15分钟。"
    }
  },
  "$$ref": "#/components/schemas/ConflictDetectSummaryResponse"
}
```

---

### 检测日历冲突摘要

- **接口ID**: 49909
- **分类**: 日历冲突管理
- **请求方式**: `GET`
- **路径**: `/workassistant-ai-agent/api/calendar/conflict/detect-summary`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-05-09 11:26:02
- **标签**: 日历冲突管理

**说明**

检测当天日历冲突，并返回前端可直接展示的冲突提示文案

**响应** (json)

```json
{
  "type": "object",
  "description": "冲突提示摘要响应",
  "properties": {
    "hasConflict": {
      "type": "boolean",
      "description": "是否存在冲突",
      "example": true
    },
    "conflictCount": {
      "type": "integer",
      "format": "int32",
      "description": "冲突组数量",
      "example": 1
    },
    "title": {
      "type": "string",
      "description": "提示标题",
      "example": "检测到1处时间冲突"
    },
    "content": {
      "type": "string",
      "description": "提示内容",
      "example": "建议《周会》提前结束15分钟"
    },
    "summaryText": {
      "type": "string",
      "description": "前端可直接展示的完整文案",
      "example": "检测到1处时间冲突，建议《周会》提前结束15分钟。"
    }
  },
  "$$ref": "#/components/schemas/ConflictDetectSummaryResponse"
}
```

---

## 聊天管理 (5)

- [同步聊天](#同步聊天--workassistant-ai-agent-api-chat-syncchat) `POST`
- [流式聊天](#流式聊天--workassistant-ai-agent-api-chat-stream) `POST`
- [简单聊天](#简单聊天--workassistant-ai-agent-api-chat) `GET`
- [测试接口](#测试接口--workassistant-ai-agent-api-chat-test) `GET`
- [健康检查](#健康检查--workassistant-ai-agent-api-chat-health) `GET`

### 同步聊天

- **接口ID**: 49326
- **分类**: 聊天管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/chat/syncChat`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:20
- **标签**: 聊天管理

**说明**

向 AI Agent 发送消息并同步获取回复

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "聊天请求",
  "properties": {
    "message": {
      "type": "string",
      "description": "用户输入的消息",
      "example": "帮我安排明天的会议"
    },
    "history": {
      "type": "array",
      "description": "对话历史记录（可选）",
      "example": [
        {
          "role": "user",
          "content": "你好"
        }
      ],
      "items": {
        "type": "object",
        "additionalProperties": {
          "type": "string"
        }
      }
    },
    "model": {
      "type": "string",
      "default": "系统默认模型",
      "description": "使用的模型名称",
      "example": "gpt-4"
    },
    "temperature": {
      "type": "number",
      "format": "double",
      "description": "温度参数，控制随机性（0-2）",
      "example": 0.7,
      "maximum": 2,
      "minimum": 0
    },
    "maxTokens": {
      "type": "integer",
      "format": "int32",
      "description": "最大生成 token 数",
      "example": 2000
    }
  },
  "required": [
    "message"
  ],
  "$$ref": "#/components/schemas/ChatRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "聊天响应",
  "properties": {
    "success": {
      "type": "boolean",
      "description": "响应状态",
      "example": true
    },
    "content": {
      "type": "string",
      "description": "AI 回复内容",
      "example": "好的，我来帮你安排明天的会议..."
    },
    "model": {
      "type": "string",
      "description": "使用的模型",
      "example": "gpt-4"
    },
    "tokenUsage": {
      "type": "object",
      "additionalProperties": {
        "type": "object"
      },
      "description": "Token 使用量统计"
    },
    "errorMessage": {
      "type": "string",
      "description": "错误信息（如果失败）",
      "example": "请求超时"
    },
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "响应时间"
    }
  },
  "$$ref": "#/components/schemas/ChatResponse"
}
```

---

### 流式聊天

- **接口ID**: 49330
- **分类**: 聊天管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/chat/stream`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:20
- **标签**: 聊天管理

**说明**

通过 Server-Sent Events (SSE) 实现流式聊天，逐步返回 AI 回复

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "聊天请求",
  "properties": {
    "message": {
      "type": "string",
      "description": "用户输入的消息",
      "example": "帮我安排明天的会议"
    },
    "history": {
      "type": "array",
      "description": "对话历史记录（可选）",
      "example": [
        {
          "role": "user",
          "content": "你好"
        }
      ],
      "items": {
        "type": "object",
        "additionalProperties": {
          "type": "string"
        }
      }
    },
    "model": {
      "type": "string",
      "default": "系统默认模型",
      "description": "使用的模型名称",
      "example": "gpt-4"
    },
    "temperature": {
      "type": "number",
      "format": "double",
      "description": "温度参数，控制随机性（0-2）",
      "example": 0.7,
      "maximum": 2,
      "minimum": 0
    },
    "maxTokens": {
      "type": "integer",
      "format": "int32",
      "description": "最大生成 token 数",
      "example": 2000
    }
  },
  "required": [
    "message"
  ],
  "$$ref": "#/components/schemas/ChatRequest"
}
```

**响应** (raw)

```
OK
```

---

### 简单聊天

- **接口ID**: 49382
- **分类**: 聊天管理
- **请求方式**: `GET`
- **路径**: `/workassistant-ai-agent/api/chat`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:21
- **标签**: 聊天管理

**说明**

通过 GET 方式快速发送聊天消息

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| message |  | 消息内容 |  |

**响应** (json)

```json
{
  "type": "object",
  "description": "聊天响应",
  "properties": {
    "success": {
      "type": "boolean",
      "description": "响应状态",
      "example": true
    },
    "content": {
      "type": "string",
      "description": "AI 回复内容",
      "example": "好的，我来帮你安排明天的会议..."
    },
    "model": {
      "type": "string",
      "description": "使用的模型",
      "example": "gpt-4"
    },
    "tokenUsage": {
      "type": "object",
      "additionalProperties": {
        "type": "object"
      },
      "description": "Token 使用量统计"
    },
    "errorMessage": {
      "type": "string",
      "description": "错误信息（如果失败）",
      "example": "请求超时"
    },
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "响应时间"
    }
  },
  "$$ref": "#/components/schemas/ChatResponse"
}
```

---

### 测试接口

- **接口ID**: 49386
- **分类**: 聊天管理
- **请求方式**: `GET`
- **路径**: `/workassistant-ai-agent/api/chat/test`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:21
- **标签**: 聊天管理

**说明**

获取服务可用端点列表

**响应** (json)

```json
{
  "type": "object",
  "additionalProperties": {
    "type": "object"
  }
}
```

---

### 健康检查

- **接口ID**: 49390
- **分类**: 聊天管理
- **请求方式**: `GET`
- **路径**: `/workassistant-ai-agent/api/chat/health`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:21
- **标签**: 聊天管理

**说明**

检查服务是否正常运行

**响应** (json)

```json
{
  "type": "object",
  "additionalProperties": {
    "type": "object"
  }
}
```

---

## 待办事项管理 (23)

- [更新待办](#更新待办--workassistant-ai-agent-api-assistant-action-items--itemid) `PUT`
- [更新建议时间](#更新建议时间--workassistant-ai-agent-api-assistant-action-items--itemid--suggested-time) `PUT`
- [批量更新待办](#批量更新待办--workassistant-ai-agent-api-assistant-action-items-batch) `PUT`
- [同步到日程](#同步到日程--workassistant-ai-agent-api-assistant-action-items--itemid--sync-to-calendar) `POST`
- [拒绝待办](#拒绝待办--workassistant-ai-agent-api-assistant-action-items--itemid--reject) `POST`
- [确认待办](#确认待办--workassistant-ai-agent-api-assistant-action-items--itemid--confirm) `POST`
- [通用文本提取待办](#通用文本提取待办--workassistant-ai-agent-api-assistant-action-items-extract) `POST`
- [从会议纪要提取待办](#从会议纪要提取待办--workassistant-ai-agent-api-assistant-action-items-extract-from-meeting) `POST`
- [从会议纪要文本提取待办](#从会议纪要文本提取待办--workassistant-ai-agent-api-assistant-action-items-extract-from-meeting-summary) `POST`
- [从聊天记录提取待办](#从聊天记录提取待办--workassistant-ai-agent-api-assistant-action-items-extract-from-chat) `POST`
- [获取待办列表（分页）](#获取待办列表-分页---workassistant-ai-agent-api-assistant-action-items) `GET`
- [/api/assistant/action-items/upcoming](#api-assistant-action-items-upcoming--workassistant-ai-agent-api-assistant-action-items-upcoming) `GET`
- [/api/assistant/action-items/pending](#api-assistant-action-items-pending--workassistant-ai-agent-api-assistant-action-items-pending) `GET`
- [获取超期待办](#获取超期待办--workassistant-ai-agent-api-assistant-action-items-overdue) `GET`
- [流式提取待办（SSE）](#流式提取待办-sse---workassistant-ai-agent-api-assistant-action-items-extract-stream) `GET`
- [/api/assistant/action-items/extract-stream-from-meeting](#api-assistant-action-items-extract-stream-from-meeting--workassistant-ai-agent-api-assistant-action-items-extract-stream-from-meeting) `GET`
- [一键推送通知](#一键推送通知--workassistant-ai-agent-api-assistant-action-items--itemid--push) `POST`
- [确认并转化为待办](#确认并转化为待办--workassistant-ai-agent-api-assistant-action-items--itemid--confirm-and-convert) `POST`
- [批量推送通知](#批量推送通知--workassistant-ai-agent-api-assistant-action-items-batch-push) `POST`
- [批量确认并转化](#批量确认并转化--workassistant-ai-agent-api-assistant-action-items-batch-confirm-convert) `POST`
- [批量保存并推送待办](#批量保存并推送待办--workassistant-ai-agent-api-assistant-action-items-save-and-push) `POST`
- [根据会议ID查询待办](#根据会议id查询待办--workassistant-ai-agent-api-assistant-action-items-list-by-meeting) `GET`
- [流式提取待办（SSE）](#流式提取待办-sse---workassistant-ai-agent-api-assistant-action-items-extract-stream) `POST`

### 更新待办

- **接口ID**: 49310
- **分类**: 待办事项管理
- **请求方式**: `PUT`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/{itemId}`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:20
- **标签**: 待办事项管理

**说明**

前端编辑后保存，支持修改内容、责任人、截止时间、优先级、备注

**路径参数**

| name | desc | example |
|---|---|---|
| itemId | 待办ID |  |

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "更新请求体",
  "properties": {
    "itemId": {
      "type": "string",
      "description": "待办ID（批量更新时必填，单条更新时从路径参数获取）",
      "example": "item-uuid-123"
    },
    "content": {
      "type": "string",
      "description": "待办内容",
      "example": "完成API接口文档"
    },
    "owner": {
      "type": "string",
      "description": "责任人姓名",
      "example": "张三"
    },
    "dueDate": {
      "type": "string",
      "format": "date-time",
      "description": "截止时间（ISO 8601格式）",
      "example": "2026-03-19T18:00:00"
    },
    "priority": {
      "type": "string",
      "description": "优先级：HIGH / MEDIUM / LOW",
      "enum": [
        "HIGH",
        "MEDIUM",
        "LOW"
      ],
      "example": "HIGH"
    },
    "remark": {
      "type": "string",
      "description": "备注信息",
      "example": "需要先完成需求评审"
    }
  },
  "$$ref": "#/components/schemas/UpdateItemApiRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "object",
      "description": "待办事项响应",
      "properties": {
        "itemId": {
          "type": "string",
          "description": "业务唯一标识",
          "example": "item-uuid-123"
        },
        "content": {
          "type": "string",
          "description": "待办内容",
          "example": "完成API接口文档"
        },
        "owner": {
          "type": "string",
          "description": "责任人",
          "example": "张三"
        },
        "ownerUserId": {
          "type": "string",
          "description": "责任人用户ID",
          "example": "zhangsan"
        },
        "dueDate": {
          "type": "string",
          "format": "date-time",
          "description": "截止时间",
          "example": "2026-03-12T18:00:00"
        },
        "suggestedTime": {
          "type": "string",
          "format": "date-time",
          "description": "AI建议时间",
          "example": "2026-03-11T14:00:00"
        },
        "evidence": {
          "type": "string",
          "description": "原文证据",
          "example": "张三提出需要在下周三完成API接口文档"
        },
        "status": {
          "type": "string",
          "description": "状态",
          "example": "PENDING"
        },
        "sourceType": {
          "type": "string",
          "description": "来源类型",
          "example": "MEETING"
        },
        "sourceId": {
          "type": "string",
          "description": "来源ID",
          "example": "meeting-uuid-456"
        },
        "sourceTitle": {
          "type": "string",
          "description": "来源标题",
          "example": "产品周会"
        },
        "priority": {
          "type": "string",
          "description": "优先级",
          "example": "HIGH"
        },
        "remark": {
          "type": "string",
          "description": "备注"
        },
        "contextSummary": {
          "type": "string",
          "description": "上下文摘要"
        },
        "calendarEventId": {
          "type": "string",
          "description": "关联的日程事件ID"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "创建时间"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time",
          "description": "更新时间"
        }
      },
      "$$ref": "#/components/schemas/ActionItemResponse"
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultActionItemResponse"
}
```

---

### 更新建议时间

- **接口ID**: 49314
- **分类**: 待办事项管理
- **请求方式**: `PUT`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/{itemId}/suggested-time`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:20
- **标签**: 待办事项管理

**说明**

更新AI建议的执行时间，格式 ISO 8601（如 2026-03-12T14:00:00）

**路径参数**

| name | desc | example |
|---|---|---|
| itemId | 待办ID |  |

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| suggestedTime |  | 建议时间（ISO 8601格式） |  |

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "object",
      "description": "待办事项响应",
      "properties": {
        "itemId": {
          "type": "string",
          "description": "业务唯一标识",
          "example": "item-uuid-123"
        },
        "content": {
          "type": "string",
          "description": "待办内容",
          "example": "完成API接口文档"
        },
        "owner": {
          "type": "string",
          "description": "责任人",
          "example": "张三"
        },
        "ownerUserId": {
          "type": "string",
          "description": "责任人用户ID",
          "example": "zhangsan"
        },
        "dueDate": {
          "type": "string",
          "format": "date-time",
          "description": "截止时间",
          "example": "2026-03-12T18:00:00"
        },
        "suggestedTime": {
          "type": "string",
          "format": "date-time",
          "description": "AI建议时间",
          "example": "2026-03-11T14:00:00"
        },
        "evidence": {
          "type": "string",
          "description": "原文证据",
          "example": "张三提出需要在下周三完成API接口文档"
        },
        "status": {
          "type": "string",
          "description": "状态",
          "example": "PENDING"
        },
        "sourceType": {
          "type": "string",
          "description": "来源类型",
          "example": "MEETING"
        },
        "sourceId": {
          "type": "string",
          "description": "来源ID",
          "example": "meeting-uuid-456"
        },
        "sourceTitle": {
          "type": "string",
          "description": "来源标题",
          "example": "产品周会"
        },
        "priority": {
          "type": "string",
          "description": "优先级",
          "example": "HIGH"
        },
        "remark": {
          "type": "string",
          "description": "备注"
        },
        "contextSummary": {
          "type": "string",
          "description": "上下文摘要"
        },
        "calendarEventId": {
          "type": "string",
          "description": "关联的日程事件ID"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "创建时间"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time",
          "description": "更新时间"
        }
      },
      "$$ref": "#/components/schemas/ActionItemResponse"
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultActionItemResponse"
}
```

---

### 批量更新待办

- **接口ID**: 49318
- **分类**: 待办事项管理
- **请求方式**: `PUT`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/batch`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:20
- **标签**: 待办事项管理

**说明**

一次提交多个待办的更新，每条记录需包含 itemId

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "array",
  "description": "批量更新请求列表",
  "items": {
    "type": "object",
    "description": "更新请求体",
    "properties": {
      "itemId": {
        "type": "string",
        "description": "待办ID（批量更新时必填，单条更新时从路径参数获取）",
        "example": "item-uuid-123"
      },
      "content": {
        "type": "string",
        "description": "待办内容",
        "example": "完成API接口文档"
      },
      "owner": {
        "type": "string",
        "description": "责任人姓名",
        "example": "张三"
      },
      "dueDate": {
        "type": "string",
        "format": "date-time",
        "description": "截止时间（ISO 8601格式）",
        "example": "2026-03-19T18:00:00"
      },
      "priority": {
        "type": "string",
        "description": "优先级：HIGH / MEDIUM / LOW",
        "enum": [
          "HIGH",
          "MEDIUM",
          "LOW"
        ],
        "example": "HIGH"
      },
      "remark": {
        "type": "string",
        "description": "备注信息",
        "example": "需要先完成需求评审"
      }
    },
    "$$ref": "#/components/schemas/UpdateItemApiRequest"
  }
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "array",
      "description": "响应数据",
      "items": {
        "type": "object",
        "description": "待办事项响应",
        "properties": {
          "itemId": {
            "type": "string",
            "description": "业务唯一标识",
            "example": "item-uuid-123"
          },
          "content": {
            "type": "string",
            "description": "待办内容",
            "example": "完成API接口文档"
          },
          "owner": {
            "type": "string",
            "description": "责任人",
            "example": "张三"
          },
          "ownerUserId": {
            "type": "string",
            "description": "责任人用户ID",
            "example": "zhangsan"
          },
          "dueDate": {
            "type": "string",
            "format": "date-time",
            "description": "截止时间",
            "example": "2026-03-12T18:00:00"
          },
          "suggestedTime": {
            "type": "string",
            "format": "date-time",
            "description": "AI建议时间",
            "example": "2026-03-11T14:00:00"
          },
          "evidence": {
            "type": "string",
            "description": "原文证据",
            "example": "张三提出需要在下周三完成API接口文档"
          },
          "status": {
            "type": "string",
            "description": "状态",
            "example": "PENDING"
          },
          "sourceType": {
            "type": "string",
            "description": "来源类型",
            "example": "MEETING"
          },
          "sourceId": {
            "type": "string",
            "description": "来源ID",
            "example": "meeting-uuid-456"
          },
          "sourceTitle": {
            "type": "string",
            "description": "来源标题",
            "example": "产品周会"
          },
          "priority": {
            "type": "string",
            "description": "优先级",
            "example": "HIGH"
          },
          "remark": {
            "type": "string",
            "description": "备注"
          },
          "contextSummary": {
            "type": "string",
            "description": "上下文摘要"
          },
          "calendarEventId": {
            "type": "string",
            "description": "关联的日程事件ID"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "创建时间"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time",
            "description": "更新时间"
          }
        },
        "$$ref": "#/components/schemas/ActionItemResponse"
      }
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultListActionItemResponse"
}
```

---

### 同步到日程

- **接口ID**: 49354
- **分类**: 待办事项管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/{itemId}/sync-to-calendar`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:20
- **标签**: 待办事项管理

**说明**

将待办标记为已同步到日历，并记录关联的日程事件ID

**路径参数**

| name | desc | example |
|---|---|---|
| itemId | 待办ID |  |

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| calendarEventId |  | 关联的日历事件ID（可选） |  |

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "object",
      "description": "待办事项响应",
      "properties": {
        "itemId": {
          "type": "string",
          "description": "业务唯一标识",
          "example": "item-uuid-123"
        },
        "content": {
          "type": "string",
          "description": "待办内容",
          "example": "完成API接口文档"
        },
        "owner": {
          "type": "string",
          "description": "责任人",
          "example": "张三"
        },
        "ownerUserId": {
          "type": "string",
          "description": "责任人用户ID",
          "example": "zhangsan"
        },
        "dueDate": {
          "type": "string",
          "format": "date-time",
          "description": "截止时间",
          "example": "2026-03-12T18:00:00"
        },
        "suggestedTime": {
          "type": "string",
          "format": "date-time",
          "description": "AI建议时间",
          "example": "2026-03-11T14:00:00"
        },
        "evidence": {
          "type": "string",
          "description": "原文证据",
          "example": "张三提出需要在下周三完成API接口文档"
        },
        "status": {
          "type": "string",
          "description": "状态",
          "example": "PENDING"
        },
        "sourceType": {
          "type": "string",
          "description": "来源类型",
          "example": "MEETING"
        },
        "sourceId": {
          "type": "string",
          "description": "来源ID",
          "example": "meeting-uuid-456"
        },
        "sourceTitle": {
          "type": "string",
          "description": "来源标题",
          "example": "产品周会"
        },
        "priority": {
          "type": "string",
          "description": "优先级",
          "example": "HIGH"
        },
        "remark": {
          "type": "string",
          "description": "备注"
        },
        "contextSummary": {
          "type": "string",
          "description": "上下文摘要"
        },
        "calendarEventId": {
          "type": "string",
          "description": "关联的日程事件ID"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "创建时间"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time",
          "description": "更新时间"
        }
      },
      "$$ref": "#/components/schemas/ActionItemResponse"
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultActionItemResponse"
}
```

---

### 拒绝待办

- **接口ID**: 49358
- **分类**: 待办事项管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/{itemId}/reject`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:20
- **标签**: 待办事项管理

**说明**

将待办状态更新为已拒绝（REJECTED）

**路径参数**

| name | desc | example |
|---|---|---|
| itemId | 待办ID |  |

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "object",
      "description": "待办事项响应",
      "properties": {
        "itemId": {
          "type": "string",
          "description": "业务唯一标识",
          "example": "item-uuid-123"
        },
        "content": {
          "type": "string",
          "description": "待办内容",
          "example": "完成API接口文档"
        },
        "owner": {
          "type": "string",
          "description": "责任人",
          "example": "张三"
        },
        "ownerUserId": {
          "type": "string",
          "description": "责任人用户ID",
          "example": "zhangsan"
        },
        "dueDate": {
          "type": "string",
          "format": "date-time",
          "description": "截止时间",
          "example": "2026-03-12T18:00:00"
        },
        "suggestedTime": {
          "type": "string",
          "format": "date-time",
          "description": "AI建议时间",
          "example": "2026-03-11T14:00:00"
        },
        "evidence": {
          "type": "string",
          "description": "原文证据",
          "example": "张三提出需要在下周三完成API接口文档"
        },
        "status": {
          "type": "string",
          "description": "状态",
          "example": "PENDING"
        },
        "sourceType": {
          "type": "string",
          "description": "来源类型",
          "example": "MEETING"
        },
        "sourceId": {
          "type": "string",
          "description": "来源ID",
          "example": "meeting-uuid-456"
        },
        "sourceTitle": {
          "type": "string",
          "description": "来源标题",
          "example": "产品周会"
        },
        "priority": {
          "type": "string",
          "description": "优先级",
          "example": "HIGH"
        },
        "remark": {
          "type": "string",
          "description": "备注"
        },
        "contextSummary": {
          "type": "string",
          "description": "上下文摘要"
        },
        "calendarEventId": {
          "type": "string",
          "description": "关联的日程事件ID"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "创建时间"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time",
          "description": "更新时间"
        }
      },
      "$$ref": "#/components/schemas/ActionItemResponse"
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultActionItemResponse"
}
```

---

### 确认待办

- **接口ID**: 49362
- **分类**: 待办事项管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/{itemId}/confirm`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:20
- **标签**: 待办事项管理

**说明**

将待办状态更新为已确认（CONFIRMED）

**路径参数**

| name | desc | example |
|---|---|---|
| itemId | 待办ID |  |

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "object",
      "description": "待办事项响应",
      "properties": {
        "itemId": {
          "type": "string",
          "description": "业务唯一标识",
          "example": "item-uuid-123"
        },
        "content": {
          "type": "string",
          "description": "待办内容",
          "example": "完成API接口文档"
        },
        "owner": {
          "type": "string",
          "description": "责任人",
          "example": "张三"
        },
        "ownerUserId": {
          "type": "string",
          "description": "责任人用户ID",
          "example": "zhangsan"
        },
        "dueDate": {
          "type": "string",
          "format": "date-time",
          "description": "截止时间",
          "example": "2026-03-12T18:00:00"
        },
        "suggestedTime": {
          "type": "string",
          "format": "date-time",
          "description": "AI建议时间",
          "example": "2026-03-11T14:00:00"
        },
        "evidence": {
          "type": "string",
          "description": "原文证据",
          "example": "张三提出需要在下周三完成API接口文档"
        },
        "status": {
          "type": "string",
          "description": "状态",
          "example": "PENDING"
        },
        "sourceType": {
          "type": "string",
          "description": "来源类型",
          "example": "MEETING"
        },
        "sourceId": {
          "type": "string",
          "description": "来源ID",
          "example": "meeting-uuid-456"
        },
        "sourceTitle": {
          "type": "string",
          "description": "来源标题",
          "example": "产品周会"
        },
        "priority": {
          "type": "string",
          "description": "优先级",
          "example": "HIGH"
        },
        "remark": {
          "type": "string",
          "description": "备注"
        },
        "contextSummary": {
          "type": "string",
          "description": "上下文摘要"
        },
        "calendarEventId": {
          "type": "string",
          "description": "关联的日程事件ID"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "创建时间"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time",
          "description": "更新时间"
        }
      },
      "$$ref": "#/components/schemas/ActionItemResponse"
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultActionItemResponse"
}
```

---

### 通用文本提取待办

- **接口ID**: 49366
- **分类**: 待办事项管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/extract`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:21
- **标签**: 待办事项管理

**说明**

自动根据 sourceType 判断来源类型（MEETING / CHAT），调用对应提取逻辑

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| userId |  | 操作用户ID |  |

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "通用文本提取请求",
  "properties": {
    "content": {
      "type": "string",
      "description": "文本内容",
      "example": "张三：API文档下周三前完成"
    },
    "sourceType": {
      "type": "string",
      "description": "来源类型：MEETING（会议纪要）/ CHAT（聊天记录）",
      "enum": [
        "MEETING",
        "CHAT"
      ],
      "example": "MEETING"
    },
    "title": {
      "type": "string",
      "description": "标题（可选，仅 MEETING 类型有效）",
      "example": "产品周会"
    },
    "participantUserIds": {
      "type": "array",
      "description": "参与人用户ID列表（可选）",
      "example": [
        "zhangsan",
        "lisi"
      ],
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "content",
    "sourceType"
  ],
  "$$ref": "#/components/schemas/ExtractTextRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "array",
      "description": "响应数据",
      "items": {
        "type": "object",
        "description": "待办事项响应",
        "properties": {
          "itemId": {
            "type": "string",
            "description": "业务唯一标识",
            "example": "item-uuid-123"
          },
          "content": {
            "type": "string",
            "description": "待办内容",
            "example": "完成API接口文档"
          },
          "owner": {
            "type": "string",
            "description": "责任人",
            "example": "张三"
          },
          "ownerUserId": {
            "type": "string",
            "description": "责任人用户ID",
            "example": "zhangsan"
          },
          "dueDate": {
            "type": "string",
            "format": "date-time",
            "description": "截止时间",
            "example": "2026-03-12T18:00:00"
          },
          "suggestedTime": {
            "type": "string",
            "format": "date-time",
            "description": "AI建议时间",
            "example": "2026-03-11T14:00:00"
          },
          "evidence": {
            "type": "string",
            "description": "原文证据",
            "example": "张三提出需要在下周三完成API接口文档"
          },
          "status": {
            "type": "string",
            "description": "状态",
            "example": "PENDING"
          },
          "sourceType": {
            "type": "string",
            "description": "来源类型",
            "example": "MEETING"
          },
          "sourceId": {
            "type": "string",
            "description": "来源ID",
            "example": "meeting-uuid-456"
          },
          "sourceTitle": {
            "type": "string",
            "description": "来源标题",
            "example": "产品周会"
          },
          "priority": {
            "type": "string",
            "description": "优先级",
            "example": "HIGH"
          },
          "remark": {
            "type": "string",
            "description": "备注"
          },
          "contextSummary": {
            "type": "string",
            "description": "上下文摘要"
          },
          "calendarEventId": {
            "type": "string",
            "description": "关联的日程事件ID"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "创建时间"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time",
            "description": "更新时间"
          }
        },
        "$$ref": "#/components/schemas/ActionItemResponse"
      }
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultListActionItemResponse"
}
```

---

### 从会议纪要提取待办

- **接口ID**: 49370
- **分类**: 待办事项管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/extract-from-meeting`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:21
- **标签**: 待办事项管理

**说明**

根据会议ID获取会议纪要内容，由AI自动提取待办事项

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| userId |  | 操作用户ID |  |

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "从会议提取请求",
  "properties": {
    "meetingId": {
      "type": "string",
      "description": "会议ID",
      "example": "meeting-uuid-123"
    },
    "participantUserIds": {
      "type": "array",
      "description": "参与人用户ID列表（可选，用于精准归属待办责任人）",
      "example": [
        "zhangsan",
        "lisi"
      ],
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "meetingId"
  ],
  "$$ref": "#/components/schemas/ExtractFromMeetingRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "array",
      "description": "响应数据",
      "items": {
        "type": "object",
        "description": "待办事项响应",
        "properties": {
          "itemId": {
            "type": "string",
            "description": "业务唯一标识",
            "example": "item-uuid-123"
          },
          "content": {
            "type": "string",
            "description": "待办内容",
            "example": "完成API接口文档"
          },
          "owner": {
            "type": "string",
            "description": "责任人",
            "example": "张三"
          },
          "ownerUserId": {
            "type": "string",
            "description": "责任人用户ID",
            "example": "zhangsan"
          },
          "dueDate": {
            "type": "string",
            "format": "date-time",
            "description": "截止时间",
            "example": "2026-03-12T18:00:00"
          },
          "suggestedTime": {
            "type": "string",
            "format": "date-time",
            "description": "AI建议时间",
            "example": "2026-03-11T14:00:00"
          },
          "evidence": {
            "type": "string",
            "description": "原文证据",
            "example": "张三提出需要在下周三完成API接口文档"
          },
          "status": {
            "type": "string",
            "description": "状态",
            "example": "PENDING"
          },
          "sourceType": {
            "type": "string",
            "description": "来源类型",
            "example": "MEETING"
          },
          "sourceId": {
            "type": "string",
            "description": "来源ID",
            "example": "meeting-uuid-456"
          },
          "sourceTitle": {
            "type": "string",
            "description": "来源标题",
            "example": "产品周会"
          },
          "priority": {
            "type": "string",
            "description": "优先级",
            "example": "HIGH"
          },
          "remark": {
            "type": "string",
            "description": "备注"
          },
          "contextSummary": {
            "type": "string",
            "description": "上下文摘要"
          },
          "calendarEventId": {
            "type": "string",
            "description": "关联的日程事件ID"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "创建时间"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time",
            "description": "更新时间"
          }
        },
        "$$ref": "#/components/schemas/ActionItemResponse"
      }
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultListActionItemResponse"
}
```

---

### 从会议纪要文本提取待办

- **接口ID**: 49374
- **分类**: 待办事项管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/extract-from-meeting-summary`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:21
- **标签**: 待办事项管理

**说明**

直接传入会议纪要文本内容，由AI提取待办事项（无需会议ID）

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| userId |  | 操作用户ID |  |

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "会议纪要内容请求",
  "properties": {
    "content": {
      "type": "string",
      "description": "会议纪要文本内容",
      "example": "本次会议决定：1. 张三负责完成API接口文档，截止下周三；2. 李四跟进测试环境部署"
    },
    "title": {
      "type": "string",
      "description": "会议标题（可选）",
      "example": "产品周会 - 2026年3月"
    },
    "participantUserIds": {
      "type": "array",
      "description": "参与人用户ID列表（可选）",
      "example": [
        "zhangsan",
        "lisi"
      ],
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "content"
  ],
  "$$ref": "#/components/schemas/MeetingSummaryRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "array",
      "description": "响应数据",
      "items": {
        "type": "object",
        "description": "待办事项响应",
        "properties": {
          "itemId": {
            "type": "string",
            "description": "业务唯一标识",
            "example": "item-uuid-123"
          },
          "content": {
            "type": "string",
            "description": "待办内容",
            "example": "完成API接口文档"
          },
          "owner": {
            "type": "string",
            "description": "责任人",
            "example": "张三"
          },
          "ownerUserId": {
            "type": "string",
            "description": "责任人用户ID",
            "example": "zhangsan"
          },
          "dueDate": {
            "type": "string",
            "format": "date-time",
            "description": "截止时间",
            "example": "2026-03-12T18:00:00"
          },
          "suggestedTime": {
            "type": "string",
            "format": "date-time",
            "description": "AI建议时间",
            "example": "2026-03-11T14:00:00"
          },
          "evidence": {
            "type": "string",
            "description": "原文证据",
            "example": "张三提出需要在下周三完成API接口文档"
          },
          "status": {
            "type": "string",
            "description": "状态",
            "example": "PENDING"
          },
          "sourceType": {
            "type": "string",
            "description": "来源类型",
            "example": "MEETING"
          },
          "sourceId": {
            "type": "string",
            "description": "来源ID",
            "example": "meeting-uuid-456"
          },
          "sourceTitle": {
            "type": "string",
            "description": "来源标题",
            "example": "产品周会"
          },
          "priority": {
            "type": "string",
            "description": "优先级",
            "example": "HIGH"
          },
          "remark": {
            "type": "string",
            "description": "备注"
          },
          "contextSummary": {
            "type": "string",
            "description": "上下文摘要"
          },
          "calendarEventId": {
            "type": "string",
            "description": "关联的日程事件ID"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "创建时间"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time",
            "description": "更新时间"
          }
        },
        "$$ref": "#/components/schemas/ActionItemResponse"
      }
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultListActionItemResponse"
}
```

---

### 从聊天记录提取待办

- **接口ID**: 49378
- **分类**: 待办事项管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/extract-from-chat`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:21
- **标签**: 待办事项管理

**说明**

对聊天内容进行AI分析，自动提取待办事项

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| userId |  | 操作用户ID |  |

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "聊天内容请求",
  "properties": {
    "content": {
      "type": "string",
      "description": "聊天记录文本内容",
      "example": "张三：这个功能下周二要上线，李四你来负责测试"
    },
    "participantUserIds": {
      "type": "array",
      "description": "参与人用户ID列表（可选）",
      "example": [
        "zhangsan",
        "lisi"
      ],
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "content"
  ],
  "$$ref": "#/components/schemas/ChatContentRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "array",
      "description": "响应数据",
      "items": {
        "type": "object",
        "description": "待办事项响应",
        "properties": {
          "itemId": {
            "type": "string",
            "description": "业务唯一标识",
            "example": "item-uuid-123"
          },
          "content": {
            "type": "string",
            "description": "待办内容",
            "example": "完成API接口文档"
          },
          "owner": {
            "type": "string",
            "description": "责任人",
            "example": "张三"
          },
          "ownerUserId": {
            "type": "string",
            "description": "责任人用户ID",
            "example": "zhangsan"
          },
          "dueDate": {
            "type": "string",
            "format": "date-time",
            "description": "截止时间",
            "example": "2026-03-12T18:00:00"
          },
          "suggestedTime": {
            "type": "string",
            "format": "date-time",
            "description": "AI建议时间",
            "example": "2026-03-11T14:00:00"
          },
          "evidence": {
            "type": "string",
            "description": "原文证据",
            "example": "张三提出需要在下周三完成API接口文档"
          },
          "status": {
            "type": "string",
            "description": "状态",
            "example": "PENDING"
          },
          "sourceType": {
            "type": "string",
            "description": "来源类型",
            "example": "MEETING"
          },
          "sourceId": {
            "type": "string",
            "description": "来源ID",
            "example": "meeting-uuid-456"
          },
          "sourceTitle": {
            "type": "string",
            "description": "来源标题",
            "example": "产品周会"
          },
          "priority": {
            "type": "string",
            "description": "优先级",
            "example": "HIGH"
          },
          "remark": {
            "type": "string",
            "description": "备注"
          },
          "contextSummary": {
            "type": "string",
            "description": "上下文摘要"
          },
          "calendarEventId": {
            "type": "string",
            "description": "关联的日程事件ID"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "创建时间"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time",
            "description": "更新时间"
          }
        },
        "$$ref": "#/components/schemas/ActionItemResponse"
      }
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultListActionItemResponse"
}
```

---

### 获取待办列表（分页）

- **接口ID**: 49394
- **分类**: 待办事项管理
- **请求方式**: `GET`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:21
- **标签**: 待办事项管理

**说明**

查询指定用户的待办事项，支持按状态过滤和分页

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| userId |  | 用户ID |  |
| statuses |  | 状态过滤（可多选，如 PENDING,CONFIRMED） |  |
| page |  | 页码，从0开始 |  |
| size |  | 每页大小 |  |

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "object",
      "description": "待办事项分页列表响应",
      "properties": {
        "items": {
          "type": "array",
          "description": "待办列表",
          "items": {
            "type": "object",
            "description": "待办事项响应",
            "properties": {
              "itemId": {
                "type": "string",
                "description": "业务唯一标识",
                "example": "item-uuid-123"
              },
              "content": {
                "type": "string",
                "description": "待办内容",
                "example": "完成API接口文档"
              },
              "owner": {
                "type": "string",
                "description": "责任人",
                "example": "张三"
              },
              "ownerUserId": {
                "type": "string",
                "description": "责任人用户ID",
                "example": "zhangsan"
              },
              "dueDate": {
                "type": "string",
                "format": "date-time",
                "description": "截止时间",
                "example": "2026-03-12T18:00:00"
              },
              "suggestedTime": {
                "type": "string",
                "format": "date-time",
                "description": "AI建议时间",
                "example": "2026-03-11T14:00:00"
              },
              "evidence": {
                "type": "string",
                "description": "原文证据",
                "example": "张三提出需要在下周三完成API接口文档"
              },
              "status": {
                "type": "string",
                "description": "状态",
                "example": "PENDING"
              },
              "sourceType": {
                "type": "string",
                "description": "来源类型",
                "example": "MEETING"
              },
              "sourceId": {
                "type": "string",
                "description": "来源ID",
                "example": "meeting-uuid-456"
              },
              "sourceTitle": {
                "type": "string",
                "description": "来源标题",
                "example": "产品周会"
              },
              "priority": {
                "type": "string",
                "description": "优先级",
                "example": "HIGH"
              },
              "remark": {
                "type": "string",
                "description": "备注"
              },
              "contextSummary": {
                "type": "string",
                "description": "上下文摘要"
              },
              "calendarEventId": {
                "type": "string",
                "description": "关联的日程事件ID"
              },
              "createdAt": {
                "type": "string",
                "format": "date-time",
                "description": "创建时间"
              },
              "updatedAt": {
                "type": "string",
                "format": "date-time",
                "description": "更新时间"
              }
            },
            "$$ref": "#/components/schemas/ActionItemResponse"
          }
        },
        "pageNumber": {
          "type": "integer",
          "format": "int32",
          "description": "当前页码",
          "example": 0
        },
        "pageSize": {
          "type": "integer",
          "format": "int32",
          "description": "每页大小",
          "example": 20
        },
        "totalElements": {
          "type": "integer",
          "format": "int64",
          "description": "总元素数",
          "example": 100
        },
        "totalPages": {
          "type": "integer",
          "format": "int32",
          "description": "总页数",
          "example": 5
        },
        "last": {
          "type": "boolean",
          "description": "是否最后一页",
          "example": false
        }
      },
      "$$ref": "#/components/schemas/ActionItemListResponse"
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultActionItemListResponse"
}
```

---

### /api/assistant/action-items/upcoming

- **接口ID**: 49398
- **分类**: 待办事项管理
- **请求方式**: `GET`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/upcoming`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:21
- **标签**: 待办事项管理

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| userId |  |  |  |
| days |  |  |  |

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "array",
      "description": "响应数据",
      "items": {
        "type": "object",
        "description": "待办事项响应",
        "properties": {
          "itemId": {
            "type": "string",
            "description": "业务唯一标识",
            "example": "item-uuid-123"
          },
          "content": {
            "type": "string",
            "description": "待办内容",
            "example": "完成API接口文档"
          },
          "owner": {
            "type": "string",
            "description": "责任人",
            "example": "张三"
          },
          "ownerUserId": {
            "type": "string",
            "description": "责任人用户ID",
            "example": "zhangsan"
          },
          "dueDate": {
            "type": "string",
            "format": "date-time",
            "description": "截止时间",
            "example": "2026-03-12T18:00:00"
          },
          "suggestedTime": {
            "type": "string",
            "format": "date-time",
            "description": "AI建议时间",
            "example": "2026-03-11T14:00:00"
          },
          "evidence": {
            "type": "string",
            "description": "原文证据",
            "example": "张三提出需要在下周三完成API接口文档"
          },
          "status": {
            "type": "string",
            "description": "状态",
            "example": "PENDING"
          },
          "sourceType": {
            "type": "string",
            "description": "来源类型",
            "example": "MEETING"
          },
          "sourceId": {
            "type": "string",
            "description": "来源ID",
            "example": "meeting-uuid-456"
          },
          "sourceTitle": {
            "type": "string",
            "description": "来源标题",
            "example": "产品周会"
          },
          "priority": {
            "type": "string",
            "description": "优先级",
            "example": "HIGH"
          },
          "remark": {
            "type": "string",
            "description": "备注"
          },
          "contextSummary": {
            "type": "string",
            "description": "上下文摘要"
          },
          "calendarEventId": {
            "type": "string",
            "description": "关联的日程事件ID"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "创建时间"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time",
            "description": "更新时间"
          }
        },
        "$$ref": "#/components/schemas/ActionItemResponse"
      }
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultListActionItemResponse"
}
```

---

### /api/assistant/action-items/pending

- **接口ID**: 49402
- **分类**: 待办事项管理
- **请求方式**: `GET`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/pending`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:21
- **标签**: 待办事项管理

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| userId |  |  |  |

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "array",
      "description": "响应数据",
      "items": {
        "type": "object",
        "description": "待办事项响应",
        "properties": {
          "itemId": {
            "type": "string",
            "description": "业务唯一标识",
            "example": "item-uuid-123"
          },
          "content": {
            "type": "string",
            "description": "待办内容",
            "example": "完成API接口文档"
          },
          "owner": {
            "type": "string",
            "description": "责任人",
            "example": "张三"
          },
          "ownerUserId": {
            "type": "string",
            "description": "责任人用户ID",
            "example": "zhangsan"
          },
          "dueDate": {
            "type": "string",
            "format": "date-time",
            "description": "截止时间",
            "example": "2026-03-12T18:00:00"
          },
          "suggestedTime": {
            "type": "string",
            "format": "date-time",
            "description": "AI建议时间",
            "example": "2026-03-11T14:00:00"
          },
          "evidence": {
            "type": "string",
            "description": "原文证据",
            "example": "张三提出需要在下周三完成API接口文档"
          },
          "status": {
            "type": "string",
            "description": "状态",
            "example": "PENDING"
          },
          "sourceType": {
            "type": "string",
            "description": "来源类型",
            "example": "MEETING"
          },
          "sourceId": {
            "type": "string",
            "description": "来源ID",
            "example": "meeting-uuid-456"
          },
          "sourceTitle": {
            "type": "string",
            "description": "来源标题",
            "example": "产品周会"
          },
          "priority": {
            "type": "string",
            "description": "优先级",
            "example": "HIGH"
          },
          "remark": {
            "type": "string",
            "description": "备注"
          },
          "contextSummary": {
            "type": "string",
            "description": "上下文摘要"
          },
          "calendarEventId": {
            "type": "string",
            "description": "关联的日程事件ID"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "创建时间"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time",
            "description": "更新时间"
          }
        },
        "$$ref": "#/components/schemas/ActionItemResponse"
      }
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultListActionItemResponse"
}
```

---

### 获取超期待办

- **接口ID**: 49406
- **分类**: 待办事项管理
- **请求方式**: `GET`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/overdue`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:21
- **标签**: 待办事项管理

**说明**

查询用户所有已超过截止时间的待办事项

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| userId |  | 用户ID |  |

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "array",
      "description": "响应数据",
      "items": {
        "type": "object",
        "description": "待办事项响应",
        "properties": {
          "itemId": {
            "type": "string",
            "description": "业务唯一标识",
            "example": "item-uuid-123"
          },
          "content": {
            "type": "string",
            "description": "待办内容",
            "example": "完成API接口文档"
          },
          "owner": {
            "type": "string",
            "description": "责任人",
            "example": "张三"
          },
          "ownerUserId": {
            "type": "string",
            "description": "责任人用户ID",
            "example": "zhangsan"
          },
          "dueDate": {
            "type": "string",
            "format": "date-time",
            "description": "截止时间",
            "example": "2026-03-12T18:00:00"
          },
          "suggestedTime": {
            "type": "string",
            "format": "date-time",
            "description": "AI建议时间",
            "example": "2026-03-11T14:00:00"
          },
          "evidence": {
            "type": "string",
            "description": "原文证据",
            "example": "张三提出需要在下周三完成API接口文档"
          },
          "status": {
            "type": "string",
            "description": "状态",
            "example": "PENDING"
          },
          "sourceType": {
            "type": "string",
            "description": "来源类型",
            "example": "MEETING"
          },
          "sourceId": {
            "type": "string",
            "description": "来源ID",
            "example": "meeting-uuid-456"
          },
          "sourceTitle": {
            "type": "string",
            "description": "来源标题",
            "example": "产品周会"
          },
          "priority": {
            "type": "string",
            "description": "优先级",
            "example": "HIGH"
          },
          "remark": {
            "type": "string",
            "description": "备注"
          },
          "contextSummary": {
            "type": "string",
            "description": "上下文摘要"
          },
          "calendarEventId": {
            "type": "string",
            "description": "关联的日程事件ID"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "创建时间"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time",
            "description": "更新时间"
          }
        },
        "$$ref": "#/components/schemas/ActionItemResponse"
      }
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultListActionItemResponse"
}
```

---

### 流式提取待办（SSE）

- **接口ID**: 49410
- **分类**: 待办事项管理
- **请求方式**: `GET`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/extract-stream`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:21
- **标签**: 待办事项管理

**说明**

通过 Server-Sent Events 逐条推送提取结果，每提取到一个待办立即返回

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| content |  | 待处理的文本内容 |  |
| title |  | 标题（可选） |  |
| participantUserIds |  | 参与人用户ID列表（可选） |  |
| userId |  | 操作用户ID |  |

**响应** (raw)

```
OK
```

---

### /api/assistant/action-items/extract-stream-from-meeting

- **接口ID**: 49414
- **分类**: 待办事项管理
- **请求方式**: `GET`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/extract-stream-from-meeting`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-06 17:31:21
- **标签**: 待办事项管理

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| meetingId |  |  |  |
| participantUserIds |  |  |  |
| userId |  |  |  |

**响应** (raw)

```
OK
```

---

### 一键推送通知

- **接口ID**: 49422
- **分类**: 待办事项管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/{itemId}/push`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-09 18:18:02
- **标签**: 待办事项管理

**说明**

将待办通过讯通推送给责任人，支持推送前保存前端修改

**路径参数**

| name | desc | example |
|---|---|---|
| itemId | 待办ID |  |

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |
| openToken |  |  | 认证token |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "推送请求（可包含前端修改的内容、截止时间、责任人）",
  "properties": {
    "itemId": {
      "type": "string",
      "description": "待办ID（批量推送时必填）",
      "example": "item-uuid-123"
    },
    "content": {
      "type": "string",
      "description": "待办内容（前端可修改）",
      "example": "完成API接口文档"
    },
    "dueDate": {
      "type": "integer",
      "format": "int64",
      "description": "截止时间（前端可修改，毫秒时间戳）",
      "example": 1710842400000
    },
    "owner": {
      "type": "string",
      "description": "责任人姓名（前端可修改）",
      "example": "张三"
    }
  },
  "$$ref": "#/components/schemas/PushRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "boolean",
      "description": "响应数据"
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultBoolean"
}
```

---

### 确认并转化为待办

- **接口ID**: 49426
- **分类**: 待办事项管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/{itemId}/confirm-and-convert`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-09 18:18:02
- **标签**: 待办事项管理

**说明**

确认AI建议的待办，并将其转化为真正的待办事项，同时推送通知给责任人

**路径参数**

| name | desc | example |
|---|---|---|
| itemId | 待办ID |  |

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| openToken |  |  | 认证token |

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "object",
      "description": "待办事项响应",
      "properties": {
        "itemId": {
          "type": "string",
          "description": "业务唯一标识",
          "example": "item-uuid-123"
        },
        "content": {
          "type": "string",
          "description": "待办内容",
          "example": "完成API接口文档"
        },
        "owner": {
          "type": "string",
          "description": "责任人",
          "example": "张三"
        },
        "ownerUserId": {
          "type": "string",
          "description": "责任人用户ID",
          "example": "zhangsan"
        },
        "dueDate": {
          "type": "string",
          "format": "date-time",
          "description": "截止时间",
          "example": "2026-03-12T18:00:00"
        },
        "suggestedTime": {
          "type": "string",
          "format": "date-time",
          "description": "AI建议时间",
          "example": "2026-03-11T14:00:00"
        },
        "evidence": {
          "type": "string",
          "description": "原文证据",
          "example": "张三提出需要在下周三完成API接口文档"
        },
        "status": {
          "type": "string",
          "description": "状态",
          "example": "PENDING"
        },
        "sourceType": {
          "type": "string",
          "description": "来源类型",
          "example": "MEETING"
        },
        "sourceId": {
          "type": "string",
          "description": "来源ID",
          "example": "meeting-uuid-456"
        },
        "sourceTitle": {
          "type": "string",
          "description": "来源标题",
          "example": "产品周会"
        },
        "priority": {
          "type": "string",
          "description": "优先级",
          "example": "HIGH"
        },
        "remark": {
          "type": "string",
          "description": "备注"
        },
        "contextSummary": {
          "type": "string",
          "description": "上下文摘要"
        },
        "calendarEventId": {
          "type": "string",
          "description": "关联的日程事件ID"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "description": "创建时间"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time",
          "description": "更新时间"
        }
      },
      "$$ref": "#/components/schemas/ActionItemResponse"
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultActionItemResponse"
}
```

---

### 批量推送通知

- **接口ID**: 49430
- **分类**: 待办事项管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/batch-push`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-09 18:18:02
- **标签**: 待办事项管理

**说明**

批量将待办通过讯通推送给责任人，支持推送前保存前端修改

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |
| openToken |  |  | 认证token |

**请求 Body (json)**

```json
{
  "type": "array",
  "description": "推送请求列表（每条可包含前端修改的内容、截止时间、责任人）",
  "items": {
    "type": "object",
    "description": "推送请求（可包含前端修改的内容、截止时间、责任人）",
    "properties": {
      "itemId": {
        "type": "string",
        "description": "待办ID（批量推送时必填）",
        "example": "item-uuid-123"
      },
      "content": {
        "type": "string",
        "description": "待办内容（前端可修改）",
        "example": "完成API接口文档"
      },
      "dueDate": {
        "type": "integer",
        "format": "int64",
        "description": "截止时间（前端可修改，毫秒时间戳）",
        "example": 1710842400000
      },
      "owner": {
        "type": "string",
        "description": "责任人姓名（前端可修改）",
        "example": "张三"
      }
    },
    "$$ref": "#/components/schemas/PushRequest"
  }
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "array",
      "description": "响应数据",
      "items": {
        "type": "object",
        "description": "待办推送结果",
        "properties": {
          "itemId": {
            "type": "string",
            "description": "待办ID",
            "example": "item-uuid-123"
          },
          "success": {
            "type": "boolean",
            "description": "是否推送成功"
          },
          "message": {
            "type": "string",
            "description": "结果消息",
            "example": "推送成功"
          }
        },
        "$$ref": "#/components/schemas/PushResult"
      }
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultListPushResult"
}
```

---

### 批量确认并转化

- **接口ID**: 49434
- **分类**: 待办事项管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/batch-confirm-convert`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-09 18:18:02
- **标签**: 待办事项管理

**说明**

批量确认AI建议的待办，并转化为真正的待办事项

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |
| openToken |  |  | 认证token |

**请求 Body (json)**

```json
{
  "type": "array",
  "description": "待办ID列表",
  "items": {
    "type": "string"
  }
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "array",
      "description": "响应数据",
      "items": {
        "type": "object",
        "description": "待办事项响应",
        "properties": {
          "itemId": {
            "type": "string",
            "description": "业务唯一标识",
            "example": "item-uuid-123"
          },
          "content": {
            "type": "string",
            "description": "待办内容",
            "example": "完成API接口文档"
          },
          "owner": {
            "type": "string",
            "description": "责任人",
            "example": "张三"
          },
          "ownerUserId": {
            "type": "string",
            "description": "责任人用户ID",
            "example": "zhangsan"
          },
          "dueDate": {
            "type": "string",
            "format": "date-time",
            "description": "截止时间",
            "example": "2026-03-12T18:00:00"
          },
          "suggestedTime": {
            "type": "string",
            "format": "date-time",
            "description": "AI建议时间",
            "example": "2026-03-11T14:00:00"
          },
          "evidence": {
            "type": "string",
            "description": "原文证据",
            "example": "张三提出需要在下周三完成API接口文档"
          },
          "status": {
            "type": "string",
            "description": "状态",
            "example": "PENDING"
          },
          "sourceType": {
            "type": "string",
            "description": "来源类型",
            "example": "MEETING"
          },
          "sourceId": {
            "type": "string",
            "description": "来源ID",
            "example": "meeting-uuid-456"
          },
          "sourceTitle": {
            "type": "string",
            "description": "来源标题",
            "example": "产品周会"
          },
          "priority": {
            "type": "string",
            "description": "优先级",
            "example": "HIGH"
          },
          "remark": {
            "type": "string",
            "description": "备注"
          },
          "contextSummary": {
            "type": "string",
            "description": "上下文摘要"
          },
          "calendarEventId": {
            "type": "string",
            "description": "关联的日程事件ID"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "创建时间"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time",
            "description": "更新时间"
          }
        },
        "$$ref": "#/components/schemas/ActionItemResponse"
      }
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultListActionItemResponse"
}
```

---

### 批量保存并推送待办

- **接口ID**: 49454
- **分类**: 待办事项管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/save-and-push`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-10 19:22:03
- **标签**: 待办事项管理

**说明**

根据会议ID保存待办，支持新增、更新、取消操作。pushMessage=true时推送消息并拆分存储到用户待办表

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "保存请求，meetingId（会议ID）、待办列表、pushMessage是否推送",
  "properties": {
    "meetingId": {
      "type": "string",
      "description": "来源ID（会议ID）",
      "example": "meeting-123"
    },
    "items": {
      "type": "array",
      "description": "待办列表",
      "items": {
        "type": "object",
        "description": "待办数据",
        "properties": {
          "itemId": {
            "type": "string",
            "description": "待办ID（新增时可为空，修改时必填）"
          },
          "content": {
            "type": "string",
            "description": "待办内容",
            "example": "完成API接口文档"
          },
          "owner": {
            "type": "string",
            "description": "责任人姓名",
            "example": "张三"
          },
          "ownerUserIds": {
            "type": "array",
            "description": "责任人用户ID列表",
            "items": {
              "type": "string"
            }
          },
          "dueDate": {
            "type": "object",
            "description": "截止时间（毫秒时间戳或ISO格式）",
            "example": 1710842400000
          },
          "priority": {
            "type": "string",
            "description": "优先级：HIGH/NORMAL/LOW",
            "example": "NORMAL"
          },
          "evidence": {
            "type": "string",
            "description": "原文证据"
          },
          "remark": {
            "type": "string",
            "description": "备注"
          },
          "new": {
            "type": "boolean"
          }
        },
        "required": [
          "content"
        ],
        "$$ref": "#/components/schemas/ActionItemData"
      }
    },
    "pushMessage": {
      "type": "boolean",
      "description": "是否需要推送消息",
      "example": false
    },
    "userId": {
      "type": "string",
      "description": "操作用户ID",
      "example": "default-user"
    },
    "needPush": {
      "type": "boolean"
    }
  },
  "required": [
    "meetingId"
  ],
  "$$ref": "#/components/schemas/SaveActionItemsRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "object",
      "description": "保存待办响应",
      "properties": {
        "success": {
          "type": "boolean",
          "description": "是否成功"
        },
        "message": {
          "type": "string",
          "description": "消息"
        },
        "savedCount": {
          "type": "integer",
          "format": "int32",
          "description": "保存的待办数量"
        },
        "pushedCount": {
          "type": "integer",
          "format": "int32",
          "description": "推送的待办数量"
        },
        "items": {
          "type": "array",
          "description": "保存的待办列表",
          "items": {
            "type": "object",
            "description": "待办事项响应",
            "properties": {
              "itemId": {
                "type": "string",
                "description": "业务唯一标识",
                "example": "item-uuid-123"
              },
              "content": {
                "type": "string",
                "description": "待办内容",
                "example": "完成API接口文档"
              },
              "owner": {
                "type": "string",
                "description": "责任人（多个用逗号分隔）",
                "example": "张三,李四"
              },
              "ownerUserIds": {
                "type": "array",
                "description": "责任人用户ID列表",
                "example": [
                  "1001",
                  "1002"
                ],
                "items": {
                  "type": "string"
                }
              },
              "dueDate": {
                "type": "string",
                "format": "date-time",
                "description": "截止时间",
                "example": "2026-03-12T18:00:00"
              },
              "dueDateTimestamp": {
                "type": "integer",
                "format": "int64",
                "description": "截止时间（毫秒时间戳）",
                "example": 1710842400000
              },
              "suggestedTime": {
                "type": "string",
                "format": "date-time",
                "description": "AI建议时间",
                "example": "2026-03-11T14:00:00"
              },
              "evidence": {
                "type": "string",
                "description": "原文证据",
                "example": "张三提出需要在下周三完成API接口文档"
              },
              "status": {
                "type": "string",
                "description": "状态",
                "example": "PENDING"
              },
              "sourceType": {
                "type": "string",
                "description": "来源类型",
                "example": "MEETING"
              },
              "sourceId": {
                "type": "string",
                "description": "来源ID",
                "example": "meeting-uuid-456"
              },
              "sourceTitle": {
                "type": "string",
                "description": "来源标题",
                "example": "产品周会"
              },
              "priority": {
                "type": "string",
                "description": "优先级",
                "example": "HIGH"
              },
              "remark": {
                "type": "string",
                "description": "备注"
              },
              "contextSummary": {
                "type": "string",
                "description": "上下文摘要"
              },
              "calendarEventId": {
                "type": "string",
                "description": "关联的日程事件ID"
              },
              "createdAt": {
                "type": "string",
                "format": "date-time",
                "description": "创建时间"
              },
              "updatedAt": {
                "type": "string",
                "format": "date-time",
                "description": "更新时间"
              }
            },
            "$$ref": "#/components/schemas/ActionItemResponse"
          }
        }
      },
      "$$ref": "#/components/schemas/SaveActionItemsResponse"
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultSaveActionItemsResponse"
}
```

---

### 根据会议ID查询待办

- **接口ID**: 49462
- **分类**: 待办事项管理
- **请求方式**: `GET`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/list-by-meeting`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-10 19:22:03
- **标签**: 待办事项管理

**说明**

查询指定会议ID下已生成的待办列表，返回deleted=false的记录

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| meetingId |  | 会议ID |  |

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "array",
      "description": "响应数据",
      "items": {
        "type": "object",
        "description": "待办事项响应",
        "properties": {
          "itemId": {
            "type": "string",
            "description": "业务唯一标识",
            "example": "item-uuid-123"
          },
          "content": {
            "type": "string",
            "description": "待办内容",
            "example": "完成API接口文档"
          },
          "owner": {
            "type": "string",
            "description": "责任人（多个用逗号分隔）",
            "example": "张三,李四"
          },
          "ownerUserIds": {
            "type": "array",
            "description": "责任人用户ID列表",
            "example": [
              "1001",
              "1002"
            ],
            "items": {
              "type": "string"
            }
          },
          "dueDate": {
            "type": "string",
            "format": "date-time",
            "description": "截止时间",
            "example": "2026-03-12T18:00:00"
          },
          "dueDateTimestamp": {
            "type": "integer",
            "format": "int64",
            "description": "截止时间（毫秒时间戳）",
            "example": 1710842400000
          },
          "suggestedTime": {
            "type": "string",
            "format": "date-time",
            "description": "AI建议时间",
            "example": "2026-03-11T14:00:00"
          },
          "evidence": {
            "type": "string",
            "description": "原文证据",
            "example": "张三提出需要在下周三完成API接口文档"
          },
          "status": {
            "type": "string",
            "description": "状态",
            "example": "PENDING"
          },
          "sourceType": {
            "type": "string",
            "description": "来源类型",
            "example": "MEETING"
          },
          "sourceId": {
            "type": "string",
            "description": "来源ID",
            "example": "meeting-uuid-456"
          },
          "sourceTitle": {
            "type": "string",
            "description": "来源标题",
            "example": "产品周会"
          },
          "priority": {
            "type": "string",
            "description": "优先级",
            "example": "HIGH"
          },
          "remark": {
            "type": "string",
            "description": "备注"
          },
          "contextSummary": {
            "type": "string",
            "description": "上下文摘要"
          },
          "calendarEventId": {
            "type": "string",
            "description": "关联的日程事件ID"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "创建时间"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time",
            "description": "更新时间"
          }
        },
        "$$ref": "#/components/schemas/ActionItemResponse"
      }
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultListActionItemResponse"
}
```

---

### 流式提取待办（SSE）

- **接口ID**: 49482
- **分类**: 待办事项管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/action-items/extract-stream`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-11 14:48:02
- **标签**: 待办事项管理

**说明**

通过 Server-Sent Events 逐条推送提取结果，每提取到一个待办立即返回。根据meetingId自动查询与会人员

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "提取请求",
  "properties": {
    "meetingId": {
      "type": "string",
      "description": "会议ID",
      "example": "meeting-uuid-123"
    },
    "content": {
      "type": "string",
      "description": "文本内容",
      "example": "张三：API文档下周三前完成"
    },
    "sourceType": {
      "type": "string",
      "description": "来源类型：MEETING（会议纪要）/ CHAT（聊天记录）",
      "enum": [
        "MEETING",
        "CHAT"
      ],
      "example": "MEETING"
    },
    "title": {
      "type": "string",
      "description": "标题（可选，仅 MEETING 类型有效）",
      "example": "产品周会"
    },
    "userId": {
      "type": "string",
      "description": "操作用户ID",
      "example": "default-user"
    }
  },
  "required": [
    "content",
    "meetingId",
    "sourceType"
  ],
  "$$ref": "#/components/schemas/ExtractTextRequest"
}
```

**响应** (raw)

```
OK
```

---

## 用户AI建议待办管理 (5)

- [拒绝待办](#拒绝待办--workassistant-ai-agent-api-assistant-user-action-items--id--reject) `POST`
- [确认待办](#确认待办--workassistant-ai-agent-api-assistant-user-action-items--id--confirm) `POST`
- [批量拒绝](#批量拒绝--workassistant-ai-agent-api-assistant-user-action-items-batch-reject) `POST`
- [批量确认](#批量确认--workassistant-ai-agent-api-assistant-user-action-items-batch-confirm) `POST`
- [查询待确认待办](#查询待确认待办--workassistant-ai-agent-api-assistant-user-action-items-pending) `GET`

### 拒绝待办

- **接口ID**: 49438
- **分类**: 用户AI建议待办管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/user-action-items/{id}/reject`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-10 19:22:02
- **标签**: 用户AI建议待办管理

**说明**

拒绝AI建议的待办，可填写拒绝原因。状态流转：PENDING → REJECTED

**路径参数**

| name | desc | example |
|---|---|---|
| id | 待办ID |  |

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "拒绝请求（可选，包含拒绝原因）",
  "properties": {
    "reason": {
      "type": "string",
      "description": "拒绝原因",
      "example": "该任务不属于我负责"
    }
  },
  "$$ref": "#/components/schemas/RejectUserActionItemRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "object",
      "description": "响应数据"
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultVoid"
}
```

---

### 确认待办

- **接口ID**: 49442
- **分类**: 用户AI建议待办管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/user-action-items/{id}/confirm`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-10 19:22:02
- **标签**: 用户AI建议待办管理

**说明**

确认AI建议的待办，可同时更新内容和截止时间，确认后转为真正的待办。状态流转：PENDING → CONFIRMED

**路径参数**

| name | desc | example |
|---|---|---|
| id | 待办ID |  |

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "确认请求（可选，包含要更新的内容和截止时间）",
  "properties": {
    "content": {
      "type": "string",
      "description": "待办内容（可选，确认时更新）",
      "example": "完成API接口文档"
    },
    "dueDate": {
      "type": "string",
      "format": "date-time",
      "description": "截止时间（可选，确认时更新）",
      "example": "2026-03-12T18:00:00"
    },
    "remark": {
      "type": "string",
      "description": "备注（可选）",
      "example": "需要协调前端配合"
    }
  },
  "$$ref": "#/components/schemas/ConfirmUserActionItemRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "object",
      "description": "响应数据"
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultVoid"
}
```

---

### 批量拒绝

- **接口ID**: 49446
- **分类**: 用户AI建议待办管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/user-action-items/batch-reject`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-10 19:22:03
- **标签**: 用户AI建议待办管理

**说明**

批量拒绝多条AI建议待办，所有待办使用相同的拒绝原因

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "ids": {
      "type": "array",
      "description": "待办ID列表",
      "items": {
        "type": "string"
      }
    },
    "request": {
      "type": "object",
      "description": "拒绝请求（可选，包含拒绝原因）",
      "properties": {
        "reason": {
          "type": "string",
          "description": "拒绝原因",
          "example": "该任务不属于我负责"
        }
      },
      "$$ref": "#/components/schemas/RejectUserActionItemRequest"
    }
  }
}
```

**响应** (json)

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "description": "用户待办响应",
    "properties": {
      "id": {
        "type": "string",
        "description": "待办ID",
        "example": "user-item-uuid-123"
      },
      "itemId": {
        "type": "string",
        "description": "关联的原始待办ID",
        "example": "item-uuid-123"
      },
      "content": {
        "type": "string",
        "description": "待办内容",
        "example": "完成API接口文档"
      },
      "dueDate": {
        "type": "string",
        "format": "date-time",
        "description": "截止时间",
        "example": "2026-03-12T18:00:00"
      },
      "status": {
        "type": "string",
        "description": "状态",
        "example": "PENDING"
      },
      "sourceType": {
        "type": "string",
        "description": "来源类型",
        "example": "MEETING"
      },
      "sourceId": {
        "type": "string",
        "description": "来源ID",
        "example": "meeting-uuid-456"
      },
      "sourceTitle": {
        "type": "string",
        "description": "来源标题",
        "example": "产品周会"
      },
      "priority": {
        "type": "string",
        "description": "优先级",
        "example": "HIGH"
      },
      "evidence": {
        "type": "string",
        "description": "原文证据",
        "example": "张三提出需要在下周三完成API接口文档"
      },
      "remark": {
        "type": "string",
        "description": "备注"
      },
      "createdAt": {
        "type": "string",
        "format": "date-time",
        "description": "创建时间"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time",
        "description": "更新时间"
      }
    },
    "$$ref": "#/components/schemas/UserActionItemResponse"
  }
}
```

---

### 批量确认

- **接口ID**: 49450
- **分类**: 用户AI建议待办管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/assistant/user-action-items/batch-confirm`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-10 19:22:03
- **标签**: 用户AI建议待办管理

**说明**

批量确认多条AI建议待办，使用原始内容转为真正的待办。如需修改单条内容，请使用单条确认接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "array",
  "description": "待办ID列表",
  "items": {
    "type": "string"
  }
}
```

**响应** (json)

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "description": "用户待办响应",
    "properties": {
      "id": {
        "type": "string",
        "description": "待办ID",
        "example": "user-item-uuid-123"
      },
      "itemId": {
        "type": "string",
        "description": "关联的原始待办ID",
        "example": "item-uuid-123"
      },
      "content": {
        "type": "string",
        "description": "待办内容",
        "example": "完成API接口文档"
      },
      "dueDate": {
        "type": "string",
        "format": "date-time",
        "description": "截止时间",
        "example": "2026-03-12T18:00:00"
      },
      "status": {
        "type": "string",
        "description": "状态",
        "example": "PENDING"
      },
      "sourceType": {
        "type": "string",
        "description": "来源类型",
        "example": "MEETING"
      },
      "sourceId": {
        "type": "string",
        "description": "来源ID",
        "example": "meeting-uuid-456"
      },
      "sourceTitle": {
        "type": "string",
        "description": "来源标题",
        "example": "产品周会"
      },
      "priority": {
        "type": "string",
        "description": "优先级",
        "example": "HIGH"
      },
      "evidence": {
        "type": "string",
        "description": "原文证据",
        "example": "张三提出需要在下周三完成API接口文档"
      },
      "remark": {
        "type": "string",
        "description": "备注"
      },
      "createdAt": {
        "type": "string",
        "format": "date-time",
        "description": "创建时间"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time",
        "description": "更新时间"
      }
    },
    "$$ref": "#/components/schemas/UserActionItemResponse"
  }
}
```

---

### 查询待确认待办

- **接口ID**: 49458
- **分类**: 用户AI建议待办管理
- **请求方式**: `GET`
- **路径**: `/workassistant-ai-agent/api/assistant/user-action-items/pending`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-10 19:22:03
- **标签**: 用户AI建议待办管理

**说明**

查询当前用户状态为待确认(PENDING)的AI建议待办列表，按创建时间倒序排列

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| page |  | 页码，从0开始 |  |
| size |  | 每页大小 |  |

**响应** (json)

```json
{
  "type": "object",
  "description": "用户待办响应",
  "properties": {
    "id": {
      "type": "string",
      "description": "待办ID",
      "example": "user-item-uuid-123"
    },
    "itemId": {
      "type": "string",
      "description": "关联的原始待办ID",
      "example": "item-uuid-123"
    },
    "content": {
      "type": "string",
      "description": "待办内容",
      "example": "完成API接口文档"
    },
    "dueDate": {
      "type": "string",
      "format": "date-time",
      "description": "截止时间",
      "example": "2026-03-12T18:00:00"
    },
    "status": {
      "type": "string",
      "description": "状态",
      "example": "PENDING"
    },
    "sourceType": {
      "type": "string",
      "description": "来源类型",
      "example": "MEETING"
    },
    "sourceId": {
      "type": "string",
      "description": "来源ID",
      "example": "meeting-uuid-456"
    },
    "sourceTitle": {
      "type": "string",
      "description": "来源标题",
      "example": "产品周会"
    },
    "priority": {
      "type": "string",
      "description": "优先级",
      "example": "HIGH"
    },
    "evidence": {
      "type": "string",
      "description": "原文证据",
      "example": "张三提出需要在下周三完成API接口文档"
    },
    "remark": {
      "type": "string",
      "description": "备注"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time",
      "description": "创建时间"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time",
      "description": "更新时间"
    }
  },
  "$$ref": "#/components/schemas/UserActionItemResponse"
}
```

---

## 用户待办内部接口 (2)

- [批量保存用户待办](#批量保存用户待办--workassistant-ai-agent-api-internal-user-action-items) `POST`
- [按来源删除用户待办](#按来源删除用户待办--workassistant-ai-agent-api-internal-user-action-items-source--sourceid) `DELETE`

### 批量保存用户待办

- **接口ID**: 49602
- **分类**: 用户待办内部接口
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/internal/user-action-items`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-26 15:36:01
- **标签**: 用户待办内部接口

**说明**

接收AI解析结果，为每个责任人创建或更新个人待办

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "待办保存请求",
  "properties": {
    "sourceId": {
      "type": "string",
      "description": "来源ID",
      "example": "task-123"
    },
    "sourceType": {
      "type": "string",
      "description": "来源类型，默认为TASK",
      "example": "TASK"
    },
    "sourceTitle": {
      "type": "string",
      "description": "来源标题",
      "example": "项目任务"
    },
    "title": {
      "type": "string",
      "description": "待办标题/内容",
      "example": "完成API接口文档"
    },
    "context": {
      "type": "string",
      "description": "上下文/描述",
      "example": "需要在周五之前完成接口文档编写"
    },
    "startTime": {
      "type": "string",
      "format": "date-time",
      "description": "开始时间",
      "example": "2026-03-25T09:00:00"
    },
    "endTime": {
      "type": "string",
      "format": "date-time",
      "description": "结束时间/截止时间",
      "example": "2026-03-25T18:00:00"
    },
    "ownerUserIds": {
      "type": "array",
      "description": "责任人用户ID列表（可为多个，会按责任人拆分成个人待办）",
      "example": [
        "user001",
        "user002"
      ],
      "items": {
        "type": "string"
      }
    },
    "priority": {
      "type": "string",
      "description": "优先级",
      "example": "HIGH"
    }
  },
  "required": [
    "ownerUserIds",
    "sourceId",
    "title"
  ],
  "$$ref": "#/components/schemas/BatchSaveUserActionItemRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "array",
      "description": "响应数据",
      "items": {
        "type": "object",
        "description": "已推送用户待办响应",
        "properties": {
          "id": {
            "type": "string",
            "description": "待办ID",
            "example": "user-item-uuid-123"
          },
          "itemId": {
            "type": "string",
            "description": "关联的原始待办ID",
            "example": "item-uuid-123"
          },
          "content": {
            "type": "string",
            "description": "待办内容",
            "example": "完成API接口文档"
          },
          "dueDate": {
            "type": "string",
            "format": "date-time",
            "description": "截止时间",
            "example": "2026-03-12T18:00:00"
          },
          "startTime": {
            "type": "string",
            "format": "date-time",
            "description": "开始时间",
            "example": "2026-03-11T14:00:00"
          },
          "status": {
            "type": "string",
            "description": "状态",
            "example": "PENDING"
          },
          "sourceType": {
            "type": "string",
            "description": "来源类型",
            "example": "MEETING"
          },
          "sourceId": {
            "type": "string",
            "description": "来源ID",
            "example": "meeting-uuid-456"
          },
          "sourceTitle": {
            "type": "string",
            "description": "来源标题",
            "example": "产品周会"
          },
          "priority": {
            "type": "string",
            "description": "优先级",
            "example": "HIGH"
          },
          "ownerUserId": {
            "type": "string",
            "description": "责任人用户ID",
            "example": "user001"
          },
          "assignerUserId": {
            "type": "string",
            "description": "指派人用户ID",
            "example": "admin001"
          },
          "assignerName": {
            "type": "string",
            "description": "指派人名称",
            "example": "张三"
          },
          "evidence": {
            "type": "string",
            "description": "原文证据",
            "example": "张三提出需要在下周三完成API接口文档"
          },
          "remark": {
            "type": "string",
            "description": "备注"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "创建时间"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time",
            "description": "更新时间"
          }
        },
        "$$ref": "#/components/schemas/UserActionItemResponse"
      }
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultListUserActionItemResponse"
}
```

---

### 按来源删除用户待办

- **接口ID**: 49603
- **分类**: 用户待办内部接口
- **请求方式**: `DELETE`
- **路径**: `/workassistant-ai-agent/api/internal/user-action-items/source/{sourceId}`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-03-26 15:36:02
- **标签**: 用户待办内部接口

**说明**

删除指定来源下的所有用户待办，如会议取消时清理相关待办

**路径参数**

| name | desc | example |
|---|---|---|
| sourceId | 来源ID |  |

**响应** (json)

```json
{
  "type": "object",
  "description": "统一响应结果",
  "properties": {
    "code": {
      "type": "string",
      "description": "响应状态码",
      "example": "CommonSuccess"
    },
    "message": {
      "type": "string",
      "description": "提示信息",
      "example": "操作成功"
    },
    "data": {
      "type": "integer",
      "format": "int32",
      "description": "响应数据"
    },
    "timestamp": {
      "type": "integer",
      "format": "int64",
      "description": "时间戳"
    },
    "traceId": {
      "type": "string",
      "description": "跟踪ID"
    },
    "args": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/components/schemas/ResultInteger"
}
```

---

## 内部日历冲突管理 (4)

- [内部查询参会人可用时段](#内部查询参会人可用时段--workassistant-ai-agent-inner-calendar-conflict-participant-availability) `POST`
- [工作区大卡片数据](#工作区大卡片数据--workassistant-ai-agent-inner-calendar-conflict-workspace-card) `POST`
- [检测日历冲突](#检测日历冲突--workassistant-ai-agent-inner-calendar-conflict-detect) `POST`
- [检测日历冲突摘要](#检测日历冲突摘要--workassistant-ai-agent-inner-calendar-conflict-detect-summary) `POST`

### 内部查询参会人可用时段

- **接口ID**: 49667
- **分类**: 内部日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/calendar/conflict/participant-availability`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-04-10 15:52:02
- **标签**: 内部日历冲突管理

**说明**

提供给内部系统调用，基于参会人忙闲情况返回 AI 智能推荐的候选时段列表

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "参会人冲突校验请求",
  "properties": {
    "meetingId": {
      "type": "string",
      "description": "会议ID，编辑会议时传入以排除自身",
      "example": "meeting-123"
    },
    "startTime": {
      "type": "string",
      "format": "date-time",
      "description": "会议开始时间",
      "example": "2026-03-12T10:00:00"
    },
    "endTime": {
      "type": "string",
      "format": "date-time",
      "description": "会议结束时间",
      "example": "2026-03-12T11:00:00"
    },
    "participantOids": {
      "type": "array",
      "description": "参会人OID列表",
      "items": {
        "type": "string"
      }
    },
    "timeZone": {
      "type": "string",
      "description": "请求时间所属时区，使用 IANA 时区 ID；不传时默认服务端系统时区",
      "example": "Asia/Shanghai"
    }
  },
  "required": [
    "endTime",
    "participantOids",
    "startTime"
  ],
  "$$ref": "#/components/schemas/ParticipantAvailabilityRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "recommendedSlots": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "startTime": {
            "type": "string",
            "format": "date-time"
          },
          "endTime": {
            "type": "string",
            "format": "date-time"
          },
          "allAvailable": {
            "type": "boolean"
          },
          "availableParticipantCount": {
            "type": "integer",
            "format": "int32"
          },
          "conflictParticipantCount": {
            "type": "integer",
            "format": "int32"
          },
          "availableParticipantOids": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "conflictParticipantOids": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "tag": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          }
        },
        "$$ref": "#/components/schemas/ParticipantAvailabilitySlot"
      }
    }
  },
  "$$ref": "#/components/schemas/ParticipantAvailabilityResponse"
}
```

---

### 工作区大卡片数据

- **接口ID**: 49686
- **分类**: 内部日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/calendar/conflict/workspace-card`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-04-23 10:40:46
- **标签**: 内部日历冲突管理

**说明**

提供会议冲突和今日日程数据，供工作区大卡片展示使用

**响应** (json)

```json
{
  "type": "object",
  "description": "工作区大卡片响应",
  "properties": {
    "success": {
      "type": "boolean",
      "description": "是否成功",
      "example": true
    },
    "data": {
      "type": "array",
      "description": "卡片数据列表",
      "items": {
        "type": "object",
        "description": "工作区大卡片单项数据",
        "properties": {
          "type": {
            "type": "string",
            "description": "数据类型：xt(消息)、workflow(审批单据)、meeting(会议)、kb(知识库)",
            "example": "meeting"
          },
          "tag": {
            "type": "array",
            "description": "标签列表",
            "example": [
              "风险风控",
              "数据告警"
            ],
            "items": {
              "type": "string"
            }
          },
          "content": {
            "type": "array",
            "description": "内容列表，展示具体分析项",
            "example": [
              "风险1",
              "风险2"
            ],
            "items": {
              "type": "string"
            }
          },
          "title": {
            "type": "string",
            "description": "标题",
            "example": "产品周会"
          },
          "bizAiInsight": {
            "type": "array",
            "description": "AI洞察分析结果列表",
            "example": [
              "建议压缩会议时长",
              "可委派给同事"
            ],
            "items": {
              "type": "string"
            }
          },
          "priority": {
            "type": "integer",
            "format": "int32",
            "description": "优先级：0(最高)、1(高)、2(中)、3(低)",
            "example": 0
          },
          "ext": {
            "type": "object",
            "additionalProperties": {
              "type": "object"
            },
            "description": "扩展字段，包含业务自定义数据"
          }
        },
        "$$ref": "#/components/schemas/WorkspaceCardItem"
      }
    }
  },
  "$$ref": "#/components/schemas/WorkspaceCardResponse"
}
```

---

### 检测日历冲突

- **接口ID**: 49687
- **分类**: 内部日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/calendar/conflict/detect`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-04-23 10:40:46
- **标签**: 内部日历冲突管理

**说明**

检测指定时间范围内的日历冲突，并返回可能的解决策略

**响应** (json)

```json
{
  "type": "object",
  "description": "冲突检测响应",
  "properties": {
    "hasConflict": {
      "type": "boolean",
      "description": "是否存在冲突",
      "example": true
    },
    "conflicts": {
      "type": "array",
      "description": "冲突列表",
      "items": {
        "type": "object",
        "properties": {
          "conflictId": {
            "type": "string"
          },
          "conflictTime": {
            "type": "object",
            "properties": {
              "startTime": {
                "type": "string",
                "format": "date-time"
              },
              "endTime": {
                "type": "string",
                "format": "date-time"
              }
            },
            "$$ref": "#/components/schemas/TimeRange"
          },
          "meetings": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "meetingId": {
                  "type": "string"
                },
                "title": {
                  "type": "string"
                },
                "content": {
                  "type": "string"
                },
                "meetingPlace": {
                  "type": "string"
                },
                "startTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "endTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "createTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "openId": {
                  "type": "string"
                },
                "userId": {
                  "type": "string"
                },
                "personName": {
                  "type": "string"
                },
                "photoUrl": {
                  "type": "string"
                },
                "department": {
                  "type": "string"
                },
                "workStatus": {
                  "type": "string",
                  "enum": [
                    "0",
                    "1",
                    "2",
                    "3",
                    "4",
                    "-1"
                  ]
                },
                "workSource": {
                  "type": "string"
                },
                "repeat": {
                  "type": "integer",
                  "format": "int32"
                },
                "repeatEndTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "batchId": {
                  "type": "string"
                },
                "roomId": {
                  "type": "string"
                },
                "roomOrderId": {
                  "type": "string"
                },
                "noticeTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "noticeTimes": {
                  "type": "string"
                },
                "calendarId": {
                  "type": "string"
                },
                "calendarName": {
                  "type": "string"
                },
                "calendarAdmin": {
                  "type": "boolean"
                },
                "participantIds": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "groupId": {
                  "type": "string"
                },
                "networkName": {
                  "type": "string"
                },
                "meetingCategory": {
                  "type": "integer",
                  "format": "int32"
                },
                "canEdit": {
                  "type": "boolean"
                },
                "owner": {
                  "type": "boolean"
                },
                "remarks": {
                  "type": "string"
                },
                "cancelTime": {
                  "type": "string",
                  "format": "date-time"
                },
                "cancelReason": {
                  "type": "string"
                },
                "source": {
                  "type": "string"
                },
                "priority": {
                  "type": "string",
                  "enum": [
                    "HIGH",
                    "NORMAL"
                  ]
                },
                "strategy": {
                  "type": "object",
                  "properties": {
                    "type": {
                      "type": "string",
                      "enum": [
                        "SHORTEN",
                        "DELEGATE",
                        "RESCHEDULE",
                        "NONE"
                      ]
                    },
                    "reason": {
                      "type": "string"
                    },
                    "targetMeetingId": {
                      "type": "string"
                    },
                    "targetMeetingTitle": {
                      "type": "string"
                    },
                    "conflictMeetingId": {
                      "type": "string"
                    },
                    "overlapMinutes": {
                      "type": "integer",
                      "format": "int32"
                    }
                  },
                  "$$ref": "#/components/schemas/ResolveStrategy"
                },
                "conflictDisplayText": {
                  "type": "string"
                },
                "priorityReason": {
                  "type": "string"
                },
                "participantCount": {
                  "type": "integer",
                  "format": "int32"
                }
              },
              "$$ref": "#/components/schemas/MeetingInfo"
            }
          }
        },
        "$$ref": "#/components/schemas/ConflictInfo"
      }
    },
    "schedules": {
      "type": "array",
      "description": "用户日程列表（用于计算空闲时间）",
      "items": {
        "type": "object",
        "properties": {
          "meetingId": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "content": {
            "type": "string"
          },
          "meetingPlace": {
            "type": "string"
          },
          "startTime": {
            "type": "string",
            "format": "date-time"
          },
          "endTime": {
            "type": "string",
            "format": "date-time"
          },
          "createTime": {
            "type": "string",
            "format": "date-time"
          },
          "openId": {
            "type": "string"
          },
          "userId": {
            "type": "string"
          },
          "personName": {
            "type": "string"
          },
          "photoUrl": {
            "type": "string"
          },
          "department": {
            "type": "string"
          },
          "workStatus": {
            "type": "string",
            "enum": [
              "0",
              "1",
              "2",
              "3",
              "4",
              "-1"
            ]
          },
          "workSource": {
            "type": "string"
          },
          "repeat": {
            "type": "integer",
            "format": "int32"
          },
          "repeatEndTime": {
            "type": "string",
            "format": "date-time"
          },
          "batchId": {
            "type": "string"
          },
          "roomId": {
            "type": "string"
          },
          "roomOrderId": {
            "type": "string"
          },
          "noticeTime": {
            "type": "string",
            "format": "date-time"
          },
          "noticeTimes": {
            "type": "string"
          },
          "calendarId": {
            "type": "string"
          },
          "calendarName": {
            "type": "string"
          },
          "calendarAdmin": {
            "type": "boolean"
          },
          "participantIds": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "groupId": {
            "type": "string"
          },
          "networkName": {
            "type": "string"
          },
          "meetingCategory": {
            "type": "integer",
            "format": "int32"
          },
          "canEdit": {
            "type": "boolean"
          },
          "owner": {
            "type": "boolean"
          },
          "remarks": {
            "type": "string"
          },
          "cancelTime": {
            "type": "string",
            "format": "date-time"
          },
          "cancelReason": {
            "type": "string"
          },
          "source": {
            "type": "string"
          },
          "priority": {
            "type": "string",
            "enum": [
              "HIGH",
              "NORMAL"
            ]
          },
          "strategy": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "SHORTEN",
                  "DELEGATE",
                  "RESCHEDULE",
                  "NONE"
                ]
              },
              "reason": {
                "type": "string"
              },
              "targetMeetingId": {
                "type": "string"
              },
              "targetMeetingTitle": {
                "type": "string"
              },
              "conflictMeetingId": {
                "type": "string"
              },
              "overlapMinutes": {
                "type": "integer",
                "format": "int32"
              }
            },
            "$$ref": "#/components/schemas/ResolveStrategy"
          },
          "conflictDisplayText": {
            "type": "string"
          },
          "priorityReason": {
            "type": "string"
          },
          "participantCount": {
            "type": "integer",
            "format": "int32"
          }
        },
        "$$ref": "#/components/schemas/MeetingInfo"
      }
    }
  },
  "$$ref": "#/components/schemas/ConflictDetectResponse"
}
```

---

### 检测日历冲突摘要

- **接口ID**: 49899
- **分类**: 内部日历冲突管理
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/calendar/conflict/detect-summary`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-05-09 11:16:02
- **标签**: 内部日历冲突管理

**说明**

提供给内部系统调用，返回当天冲突的提示文案

**响应** (json)

```json
{
  "type": "object",
  "description": "冲突提示摘要响应",
  "properties": {
    "hasConflict": {
      "type": "boolean",
      "description": "是否存在冲突",
      "example": true
    },
    "conflictCount": {
      "type": "integer",
      "format": "int32",
      "description": "冲突组数量",
      "example": 1
    },
    "title": {
      "type": "string",
      "description": "提示标题",
      "example": "检测到1处时间冲突"
    },
    "content": {
      "type": "string",
      "description": "提示内容",
      "example": "建议《周会》提前结束15分钟"
    },
    "summaryText": {
      "type": "string",
      "description": "前端可直接展示的完整文案",
      "example": "检测到1处时间冲突，建议《周会》提前结束15分钟。"
    }
  },
  "$$ref": "#/components/schemas/ConflictDetectSummaryResponse"
}
```

---

## 关联会议推荐 (1)

- [查询关联会议推荐](#查询关联会议推荐--workassistant-ai-agent-api-calendar-meeting--meetingid--related) `GET`

### 查询关联会议推荐

- **接口ID**: 49879
- **分类**: 关联会议推荐
- **请求方式**: `GET`
- **路径**: `/workassistant-ai-agent/api/calendar/meeting/{meetingId}/related`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-05-08 21:48:03
- **标签**: 关联会议推荐

**说明**

基于当前会议获取高关联的会议推荐结果

**路径参数**

| name | desc | example |
|---|---|---|
| meetingId | 会议ID |  |

**响应** (json)

```json
{
  "type": "object",
  "description": "关联会议推荐结果",
  "properties": {
    "currentMeetingId": {
      "type": "string",
      "description": "当前会议ID"
    },
    "candidateCount": {
      "type": "integer",
      "format": "int32",
      "description": "候选会议数量"
    },
    "recommendations": {
      "type": "array",
      "description": "推荐结果",
      "items": {
        "type": "object",
        "description": "关联会议推荐项",
        "properties": {
          "meetingId": {
            "type": "string",
            "description": "会议ID"
          },
          "title": {
            "type": "string",
            "description": "会议标题"
          },
          "detailUrl": {
            "type": "string",
            "description": "会议详情跳转链接"
          }
        },
        "$$ref": "#/components/schemas/Item"
      }
    }
  },
  "$$ref": "#/components/schemas/RelatedMeetingRecommendationResponse"
}
```

---

## 会议分类 (1)

- [推断会议类型](#推断会议类型--workassistant-ai-agent-api-calendar-meeting-category) `POST`

### 推断会议类型

- **接口ID**: 49894
- **分类**: 会议分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/calendar/meeting/category`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-05-08 23:54:02
- **标签**: 会议分类

**说明**

基于会议标题和内容，通过关键词匹配和AI语义推断判断会议类型。返回结果包含类型编码（0-内部会议，1-外部拜访，2-外部来访）和推断方式。

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "会议类型推断请求",
  "properties": {
    "title": {
      "type": "string",
      "description": "会议标题",
      "example": "产品周会"
    },
    "content": {
      "type": "string",
      "description": "会议内容/描述（可选）",
      "example": "讨论Q2产品规划，与腾讯团队交流合作方案"
    }
  },
  "required": [
    "title"
  ],
  "$$ref": "#/components/schemas/MeetingCategoryRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "会议类型推断响应",
  "properties": {
    "category": {
      "type": "integer",
      "format": "int32",
      "description": "会议类型编码：0-内部会议，1-外部拜访，2-外部来访",
      "example": 0
    },
    "categoryName": {
      "type": "string",
      "description": "会议类型名称",
      "example": "内部会议"
    },
    "method": {
      "type": "string",
      "description": "推断方式：keyword-关键词匹配，ai-AI语义推断",
      "example": "keyword"
    }
  },
  "$$ref": "#/components/schemas/MeetingCategoryResponse"
}
```

---

## 内部会议分类 (2)

- [推断单个会议类型](#推断单个会议类型--workassistant-ai-agent-inner-meeting-category-classify) `POST`
- [批量推断会议类型](#批量推断会议类型--workassistant-ai-agent-inner-meeting-category-batch-classify) `POST`

### 推断单个会议类型

- **接口ID**: 49954
- **分类**: 内部会议分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/meeting-category/classify`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-05-09 15:20:02
- **标签**: 内部会议分类

**说明**

基于会议标题和内容推断会议类型（内部调用）。

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "会议类型推断请求",
  "properties": {
    "meetingId": {
      "type": "string",
      "description": "会议ID（批量场景下用于对应请求和响应）",
      "example": "meeting123"
    },
    "title": {
      "type": "string",
      "description": "会议标题",
      "example": "产品周会"
    },
    "content": {
      "type": "string",
      "description": "会议内容/描述（可选）",
      "example": "讨论Q2产品规划，与腾讯团队交流合作方案"
    }
  },
  "required": [
    "title"
  ],
  "$$ref": "#/components/schemas/MeetingCategoryRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "会议类型推断响应",
  "properties": {
    "meetingId": {
      "type": "string",
      "description": "会议ID（与请求中的meetingId对应）",
      "example": "meeting123"
    },
    "category": {
      "type": "integer",
      "format": "int32",
      "description": "会议类型编码：0-内部会议，1-外部拜访，2-外部来访",
      "example": 0
    },
    "categoryName": {
      "type": "string",
      "description": "会议类型名称",
      "example": "内部会议"
    },
    "method": {
      "type": "string",
      "description": "推断方式：keyword-关键词匹配，ai-AI语义推断",
      "example": "keyword"
    }
  },
  "$$ref": "#/components/schemas/MeetingCategoryResponse"
}
```

---

### 批量推断会议类型

- **接口ID**: 49959
- **分类**: 内部会议分类
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/meeting-category/batch-classify`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-05-09 15:20:03
- **标签**: 内部会议分类

**说明**

批量推断多个会议的类型，返回分类结果列表。用于后台扫描任务批量处理。eid/oid 通过请求头 X-Requested-eid/X-Requested-oid 传入。

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "批量会议类型推断请求",
  "properties": {
    "meetings": {
      "type": "array",
      "description": "待分类的会议列表",
      "items": {
        "type": "object",
        "description": "会议类型推断请求",
        "properties": {
          "meetingId": {
            "type": "string",
            "description": "会议ID（批量场景下用于对应请求和响应）",
            "example": "meeting123"
          },
          "title": {
            "type": "string",
            "description": "会议标题",
            "example": "产品周会"
          },
          "content": {
            "type": "string",
            "description": "会议内容/描述（可选）",
            "example": "讨论Q2产品规划，与腾讯团队交流合作方案"
          }
        },
        "required": [
          "title"
        ],
        "$$ref": "#/components/schemas/MeetingCategoryRequest"
      }
    }
  },
  "required": [
    "meetings"
  ],
  "$$ref": "#/components/schemas/BatchMeetingCategoryRequest"
}
```

**响应** (json)

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "description": "会议类型推断响应",
    "properties": {
      "meetingId": {
        "type": "string",
        "description": "会议ID（与请求中的meetingId对应）",
        "example": "meeting123"
      },
      "category": {
        "type": "integer",
        "format": "int32",
        "description": "会议类型编码：0-内部会议，1-外部拜访，2-外部来访",
        "example": 0
      },
      "categoryName": {
        "type": "string",
        "description": "会议类型名称",
        "example": "内部会议"
      },
      "method": {
        "type": "string",
        "description": "推断方式：keyword-关键词匹配，ai-AI语义推断",
        "example": "keyword"
      }
    },
    "$$ref": "#/components/schemas/MeetingCategoryResponse"
  }
}
```

---

## 客户洞察 (2)

- [生成客户洞察](#生成客户洞察--workassistant-ai-agent-api-customer-insight-generate) `POST`
- [生成客户洞察（SSE 流式）](#生成客户洞察-sse-流式---workassistant-ai-agent-api-customer-insight-generate-stream) `POST`

### 生成客户洞察

- **接口ID**: 50071
- **分类**: 客户洞察
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/customer-insight/generate`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-05-13 15:38:03
- **标签**: 客户洞察

**说明**

根据会议ID查询会议详情，从中提取目标公司及关键人物，通过火山引擎联网搜索获取公司背景和最新动态，由AI生成破冰话题与潜在合作切入点建议。仅适用于外部拜访或外部来访类型的会议。

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "客户洞察请求",
  "properties": {
    "meetingId": {
      "type": "string",
      "description": "会议ID"
    }
  },
  "required": [
    "meetingId"
  ],
  "$$ref": "#/components/schemas/CustomerInsightRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "客户洞察响应",
  "properties": {
    "companyName": {
      "type": "string",
      "description": "提取出的目标公司名称"
    },
    "keyPersons": {
      "type": "array",
      "description": "提取出的关键人物列表",
      "items": {
        "type": "string"
      }
    },
    "companyBackground": {
      "type": "string",
      "description": "公司背景概要（200字以内）"
    },
    "latestNews": {
      "type": "array",
      "description": "最新动态列表",
      "items": {
        "type": "object",
        "description": "新闻条目",
        "properties": {
          "title": {
            "type": "string",
            "description": "新闻标题"
          },
          "summary": {
            "type": "string",
            "description": "摘要"
          },
          "publishTime": {
            "type": "string",
            "description": "发布时间"
          },
          "url": {
            "type": "string",
            "description": "原文链接"
          },
          "type": {
            "type": "string",
            "description": "类型：COMPANY / PERSON"
          }
        },
        "$$ref": "#/components/schemas/NewsItem"
      }
    },
    "iceBreakingSuggestions": {
      "type": "array",
      "description": "破冰与会谈建议",
      "items": {
        "type": "string"
      }
    }
  },
  "$$ref": "#/components/schemas/CustomerInsightResponse"
}
```

---

### 生成客户洞察（SSE 流式）

- **接口ID**: 50335
- **分类**: 客户洞察
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/customer-insight/generate-stream`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-05-28 18:02:02
- **标签**: 客户洞察

**说明**

与 /generate 同入参，以 Server-Sent Events 分阶段推送进度与结果：prepare→entities→news→insight→complete。推荐前端使用本接口以获得更好的等待体验。

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "客户洞察请求",
  "properties": {
    "meetingId": {
      "type": "string",
      "description": "会议ID"
    }
  },
  "required": [
    "meetingId"
  ],
  "$$ref": "#/components/schemas/CustomerInsightRequest"
}
```

**响应** (raw)

```
OK
```

---

## 录音总结 (4)

- [处理录音总结](#处理录音总结--workassistant-ai-agent-api-transcript-summary-process) `POST`
- [【内部测试】传文本直接测试提示词](#内部测试-传文本直接测试提示词--workassistant-ai-agent-api-transcript-summary-inner-test) `POST`
- [【内部】传文本直接处理并回写](#内部-传文本直接处理并回写--workassistant-ai-agent-api-transcript-summary-inner-process) `POST`
- [流式处理录音总结](#流式处理录音总结--workassistant-ai-agent-api-transcript-summary-process-stream) `POST`

### 处理录音总结

- **接口ID**: 50783
- **分类**: 录音总结
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/transcript/summary/process`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-10 17:22:03
- **标签**: 录音总结

**说明**

根据 transcriptId 查询转写文本和人工笔记，结合 scene 场景生成对应内容。scene参数：summary(录音总结)、speaking_points(发言思路)、speech_draft(发言稿)、what_missed(错过了什么)

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "transcriptId": {
      "type": "string"
    },
    "scene": {
      "type": "string"
    }
  },
  "required": [
    "transcriptId"
  ],
  "$$ref": "#/components/schemas/TranscriptSummaryRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "content": {
      "type": "string"
    },
    "coreConclusions": {
      "type": "string"
    },
    "discussionPoints": {
      "type": "string"
    },
    "actionItems": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string"
          },
          "assignee": {
            "type": "string"
          },
          "dueDate": {
            "type": "integer",
            "format": "int64"
          }
        },
        "$$ref": "#/components/schemas/ActionItem"
      }
    },
    "scene": {
      "type": "string"
    },
    "saved": {
      "type": "boolean"
    },
    "generatedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "$$ref": "#/components/schemas/TranscriptSummaryResponse"
}
```

---

### 【内部测试】传文本直接测试提示词

- **接口ID**: 50791
- **分类**: 录音总结
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/transcript/summary/inner/test`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-10 17:22:03
- **标签**: 录音总结

**说明**

跳过转写服务查询，直接传入文本测试 LLM 效果。不回写速记库。

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string"
    },
    "note": {
      "type": "string"
    },
    "scene": {
      "type": "string"
    }
  },
  "required": [
    "text"
  ],
  "$$ref": "#/components/schemas/TextTestRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "content": {
      "type": "string"
    },
    "coreConclusions": {
      "type": "string"
    },
    "discussionPoints": {
      "type": "string"
    },
    "actionItems": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string"
          },
          "assignee": {
            "type": "string"
          },
          "dueDate": {
            "type": "integer",
            "format": "int64"
          }
        },
        "$$ref": "#/components/schemas/ActionItem"
      }
    },
    "scene": {
      "type": "string"
    },
    "saved": {
      "type": "boolean"
    },
    "generatedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "$$ref": "#/components/schemas/TranscriptSummaryResponse"
}
```

---

### 【内部】传文本直接处理并回写

- **接口ID**: 50799
- **分类**: 录音总结
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/transcript/summary/inner/process`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-10 17:22:03
- **标签**: 录音总结

**说明**

跳过转写服务查询，直接传入文本处理。summary 场景会真实回写到速记库。

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "stenoId": {
      "type": "string"
    },
    "text": {
      "type": "string"
    },
    "note": {
      "type": "string"
    },
    "scene": {
      "type": "string"
    }
  },
  "required": [
    "stenoId",
    "text"
  ],
  "$$ref": "#/components/schemas/TextProcessRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "content": {
      "type": "string"
    },
    "coreConclusions": {
      "type": "string"
    },
    "discussionPoints": {
      "type": "string"
    },
    "actionItems": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string"
          },
          "assignee": {
            "type": "string"
          },
          "dueDate": {
            "type": "integer",
            "format": "int64"
          }
        },
        "$$ref": "#/components/schemas/ActionItem"
      }
    },
    "scene": {
      "type": "string"
    },
    "saved": {
      "type": "boolean"
    },
    "generatedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "$$ref": "#/components/schemas/TranscriptSummaryResponse"
}
```

---

### 流式处理录音总结

- **接口ID**: 50807
- **分类**: 录音总结
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/api/transcript/summary/process-stream`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-07-13 11:38:03
- **标签**: 录音总结

**说明**

与 /process 功能相同，但以 SSE 流式返回。事件类型：start → chunk(多个) → complete。

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "录音总结处理请求",
  "properties": {
    "transcriptId": {
      "type": "string",
      "description": "逐字稿ID（速记ID）",
      "example": "abc123def456"
    },
    "scene": {
      "type": "string",
      "description": "业务场景类型：summary(录音总结)、speaking_points(发言思路)、speech_draft(发言稿)、what_missed(错过了什么)",
      "enum": [
        "summary",
        "speaking_points",
        "speech_draft",
        "what_missed"
      ],
      "example": "summary"
    }
  },
  "required": [
    "transcriptId"
  ],
  "$$ref": "#/components/schemas/TranscriptSummaryRequest"
}
```

**响应** (raw)

```
OK
```

---

## 内部录音总结 (1)

- [直接传数据生成录音总结](#直接传数据生成录音总结--workassistant-ai-agent-inner-transcript-summary-generate) `POST`

### 直接传数据生成录音总结

- **接口ID**: 51031
- **分类**: 内部录音总结
- **请求方式**: `POST`
- **路径**: `/workassistant-ai-agent/inner/transcript/summary/generate`
- **状态**: undone
- **维护人**: heng_xu
- **更新时间**: 2026-08-03 20:46:03
- **标签**: 内部录音总结

**说明**

调用方本身持有转写文本和笔记，直接传入生成总结，不再反查速记库。summary 场景会回写速记库。eid/oid 通过请求头 X-Requested-eid / X-Requested-oid 传入。scene参数：summary(录音总结)、speaking_points(发言思路)、speech_draft(发言稿)、what_missed(错过了什么)

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "description": "录音总结内部数据请求（直接传入数据，不查速记库）",
  "properties": {
    "stenoId": {
      "type": "string",
      "description": "速记ID（用于 summary 场景回写速记库）",
      "example": "abc123def456"
    },
    "transcript": {
      "type": "string",
      "description": "转写全文"
    },
    "title": {
      "type": "string",
      "description": "录音标题（可选）"
    },
    "note": {
      "type": "string",
      "description": "人工笔记（可选）"
    },
    "durationMinutes": {
      "type": "integer",
      "format": "int32",
      "description": "录音时长（分钟，可选）",
      "example": 30
    },
    "scene": {
      "type": "string",
      "description": "业务场景类型：summary(录音总结)、speaking_points(发言思路)、speech_draft(发言稿)、what_missed(错过了什么)",
      "enum": [
        "summary",
        "speaking_points",
        "speech_draft",
        "what_missed"
      ],
      "example": "summary"
    }
  },
  "required": [
    "stenoId",
    "transcript"
  ],
  "$$ref": "#/components/schemas/TranscriptSummaryDataRequest"
}
```

**响应** (json)

```json
{
  "type": "object",
  "description": "录音总结处理响应",
  "properties": {
    "title": {
      "type": "string",
      "description": "AI 生成的标题",
      "example": "产品迭代规划会议"
    },
    "content": {
      "type": "string",
      "description": "生成的正文内容（Markdown格式，用于前端展示）",
      "example": "## 会议概要\n本次会议讨论了..."
    },
    "coreConclusions": {
      "type": "string",
      "description": "核心结论（summary场景返回）",
      "example": "1. 确定下周完成原型设计\n2. 测试环境周五前准备好"
    },
    "discussionPoints": {
      "type": "string",
      "description": "讨论要点（summary场景返回）",
      "example": "关于新功能优先级的讨论..."
    },
    "actionItems": {
      "type": "array",
      "description": "待办事项列表（结构化，便于前端单独展示）",
      "items": {
        "type": "object",
        "description": "待办事项",
        "properties": {
          "text": {
            "type": "string",
            "description": "待办内容",
            "example": "完成原型设计"
          },
          "assignee": {
            "type": "string",
            "description": "责任人（如提及）",
            "example": "张三"
          },
          "dueDate": {
            "type": "integer",
            "format": "int64",
            "description": "截止日期（毫秒时间戳）",
            "example": 1720454400000
          }
        },
        "$$ref": "#/components/schemas/ActionItem"
      }
    },
    "scene": {
      "type": "string",
      "description": "场景类型",
      "enum": [
        "summary",
        "speaking_points",
        "speech_draft",
        "what_missed"
      ],
      "example": "summary"
    },
    "saved": {
      "type": "boolean",
      "description": "是否已回写到速记服务（仅summary场景会回写）",
      "example": true
    },
    "generatedAt": {
      "type": "string",
      "format": "date-time",
      "description": "生成时间",
      "example": "2026-07-10T15:30:00+08:00"
    }
  },
  "$$ref": "#/components/schemas/TranscriptSummaryResponse"
}
```

---
