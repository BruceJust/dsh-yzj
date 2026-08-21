# collaborative-component (pid=107)

- **basepath**: `/api/collaborative`
- **接口总数**: 43
- **项目说明**: 协同组件

## 公共分类 (1)

- [协作流-获取审批详情](#协作流-获取审批详情--api-collaborative-api-collaborative-component-getflowinfo) `POST`

### 协作流-获取审批详情

- **接口ID**: 22371
- **分类**: 公共分类
- **请求方式**: `POST`
- **路径**: `/api/collaborative/api/collaborative/component/getFlowInfo`
- **状态**: done
- **维护人**: lin_liu
- **更新时间**: 2022-04-06 15:05:05

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |
| X-Requested-jwt |  |  | jwt鉴权参数 |

**请求 Body (json)**

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "dsId": {
      "type": "string",
      "description": "数据源id 没有可以不传"
    },
    "dsType": {
      "type": "string",
      "description": "数据源类型：智能审批 cloudflow 星空 xingkong"
    },
    "formId": {
      "type": "string",
      "description": "表单id 必传"
    },
    "modelCode": {
      "type": "string",
      "description": "模型id 必传"
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
    "success": {
      "type": "boolean"
    },
    "error": {
      "type": "null"
    },
    "errorCode": {
      "type": "number"
    },
    "data": {
      "type": "object",
      "properties": {
        "imgUrl": {
          "type": "string"
        },
        "importantInfo": {
          "type": "object",
          "properties": {
            "流水号": {
              "type": "string"
            },
            "提交人": {
              "type": "string"
            },
            "所属部门": {
              "type": "string"
            }
          }
        },
        "flowDetailUrl": {
          "type": "string"
        },
        "title": {
          "type": "string"
        }
      }
    }
  }
}
```

---

## 业务素材库接口 (9)

- [获取素材分组](#获取素材分组--api-collaborative-material-listmaterialgroup) `GET`
- [添加业务素材组](#添加业务素材组--api-collaborative-material-addbusinessmaterialgroup) `POST`
- [更新业务素材分组](#更新业务素材分组--api-collaborative-material-updatebusinessmaterialgroup) `POST`
- [删除业务素材分组](#删除业务素材分组--api-collaborative-material-deletebusinessmaterialgroup-id-6397de0b71de0762ac7a49ad) `GET`
- [批量添加业务素材](#批量添加业务素材--api-collaborative-material-batchaddbusinessmaterial) `POST`
- [获取业务素材列表](#获取业务素材列表--api-collaborative-material-listbusinessmaterial-page-1-size-10-materialgroupid-6397d63c71de07940cbbe075) `GET`
- [移动业务素材到分组](#移动业务素材到分组--api-collaborative-material-movematerialtogroup) `POST`
- [批量删除业务素材](#批量删除业务素材--api-collaborative-material-batchdelbusinessmaterial) `POST`
- [批量排序业务素材分组](#批量排序业务素材分组--api-collaborative-material-batchorderbusinessgroup) `POST`

### 获取素材分组

- **接口ID**: 32172
- **分类**: 业务素材库接口
- **请求方式**: `GET`
- **路径**: `/api/collaborative/material/listMaterialGroup`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-16 14:25:23

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| businessId |  |  | businessId=1001!portal!63944239cc485110dc6ffe39 |

**响应** (json)

```json
{
  "success": true,
  "error": null,
  "errorCode": 0,
  "data": {
    "systemGroup": [              //系统素材分组
      {
        "id": "6396c2e2cc48514e04222e45",
        "name": "系统图标",
        "order": 2,
        "groupType": 0,
        "resourceKey": [
          "1001"
        ],
        "materialCount": 0,
        "businessId": null,
        "createDate": 1670824674131,
        "updateDate": 1670834460655
      }
    ],
    "businessGroup": [             //业务素材分组
      {
        "id": "6397d63c71de07940cbbe075",
        "name": "门户素材",
        "order": 1,
        "groupType": 1,
        "resourceKey": null,
        "materialCount": 0,
        "businessId": "1001!portal!63944239cc485110dc6ffe39",
        "createDate": 1670824674131,
        "updateDate": 1670834460655
      }
    ]
  }
}
```

---

### 添加业务素材组

- **接口ID**: 32282
- **分类**: 业务素材库接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/material/addBusinessMaterialGroup`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-17 14:30:29

**说明**

<p><span class="colour" style="color: rgb(0, 0, 0);">1001:智能门户,1002:新闻公告,1003:智能会议,1004:智能审批,1005:应用管理,1006:人员组织,1009:公共号列表,1010:工作汇报,1013:电子签约</span></p>
<p><span class="colour" style="color: rgb(0, 0, 0);">businessId规则</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">门户就传1001!portal!xxxxxxxxxxxxxxxxxx 知识中心就传1002!catalogue!xxxxxxxxxxxxxxx</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">resouceKey是素材库给的每个业务都会给一个</span><br>
<span class="colour" style="color: rgb(0, 0, 0);">custom是业务自定义的，id是业务对应具体使用素材库的地方传的id</span></p>

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
    "name":"门户素材2",
    "businessId":"1001!portal!63944239cc485110dc6ffe39", //业务标识  resourceKey!custom!id
    "order":1 
}
```

**响应** (json)

```json
{
  "success": true,
  "error": null,
  "errorCode": 0,
  "data": true
}
```

---

### 更新业务素材分组

- **接口ID**: 32287
- **分类**: 业务素材库接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/material/updateBusinessMaterialGroup`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-16 14:27:30

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "id": "6397d63c71de07940cbbe075",
  "name": "门户卡片素材",
  "order": "2"
}
```

**响应** (json)

```json
{
  "success": true,
  "error": null,
  "errorCode": 0,
  "data": true
}
```

---

### 删除业务素材分组

- **接口ID**: 32292
- **分类**: 业务素材库接口
- **请求方式**: `GET`
- **路径**: `/api/collaborative/material/deleteBusinessMaterialGroup?id=6397de0b71de0762ac7a49ad`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-16 14:28:13

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| id |  |  | id=6397de0b71de0762ac7a49ad |

**响应** (json)

```json
{
  "success": true,
  "error": null,
  "errorCode": 0,
  "data": true
}
```

---

### 批量添加业务素材

- **接口ID**: 32297
- **分类**: 业务素材库接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/material/batchAddBusinessMaterial`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-16 14:29:15

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
    "materialGroupId":"6397d63c71de07940cbbe075", //素材组id
    "materialList":[
            {
                "fileId":"886",             //文件id
                "fileName":"图3"            //文件名称
            },
            {
                "fileId":"997",
                "fileName":"图4"
            }
        
        ]
}
```

**响应** (json)

```json
{
  "success": true,
  "error": null,
  "errorCode": 0,
  "data": true
}
```

---

### 获取业务素材列表

- **接口ID**: 32302
- **分类**: 业务素材库接口
- **请求方式**: `GET`
- **路径**: `/api/collaborative/material/listBusinessMaterial?page=1&size=10&materialGroupId=6397d63c71de07940cbbe075`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-16 14:31:07

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| page |  | 页码 |  |
| size |  | 显示条数 |  |
| materialGroupId |  | 素材组id |  |

**响应** (json)

```json
{
	"success": true,
	"error": null,
	"errorCode": 0,
	"data": {
		"total": 2,   //总条数
		"data": [
			{
				"id": "6397eb2f71de0702c4265bb0",  //素材id
				"fileId": "886",                   //文件id
				"fileName": "图3",                 //文件名称
				"materialGroupId": "6397de0b71de0762ac7a49ad",   //素材组id
				"createDate": null,
				"updateDate": null
			},
			{
				"id": "6397eb2f71de0702c4265bb1",
				"fileId": "997",
				"fileName": "图4",
				"materialGroupId": "6397de0b71de0762ac7a49ad",
				"createDate": null,
				"updateDate": null
			}
		]
	}
}
```

---

### 移动业务素材到分组

- **接口ID**: 32307
- **分类**: 业务素材库接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/material/moveMaterialToGroup`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-16 14:32:10

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
    "materialGroupId":"6397de0b71de0762ac7a49ad",  //素材组id
    "ids":[
        "6397eb2f71de0702c4265bb0",                 //素材id
        "6397eb2f71de0702c4265bb1"
        ]
}
```

**响应** (json)

```json
{
  "success": true,
  "error": null,
  "errorCode": 0,
  "data": true
}
```

---

### 批量删除业务素材

- **接口ID**: 32312
- **分类**: 业务素材库接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/material/batchDelBusinessMaterial`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-16 14:35:45

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
    "ids":[
        "6397eb2f71de0702c4265bb0",                 //素材id
        "6397eb2f71de0702c4265bb1"
        ]
}
```

**响应** (json)

```json
{
  "success": true,
  "error": null,
  "errorCode": 0,
  "data": true
}
```

---

### 批量排序业务素材分组

- **接口ID**: 32392
- **分类**: 业务素材库接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/material/batchOrderBusinessGroup`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-30 10:45:15

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "groups": [
    {
      "id": "63abf6de55790100019e33b9",
      "order": 3
    },
    {
      "id": "63abf6de55790100019e33b8",
      "order": 2
    },
    {
      "id": "63a162ac1ca1600001d1228b",
      "order": 1
    }
  ]
}
```

**响应** (json)

```json
{
  "success": true,
  "error": null,
  "errorCode": 0,
  "data": true
}
```

---

## 素材组件接口 (12)

- [新增系统素材](#新增系统素材--api-collaborative-material-addsystemmaterial) `POST`
- [业务列表](#业务列表--api-collaborative-material-allresource) `GET`
- [删除系统分组所属业务维护](#删除系统分组所属业务维护--api-collaborative-material-delresource) `POST`
- [删除系统素材](#删除系统素材--api-collaborative-material-delsystemmaterial) `POST`
- [删除系统分组](#删除系统分组--api-collaborative-material-delsystemmaterialgroup) `POST`
- [系统分组列表](#系统分组列表--api-collaborative-material-listsystemmaterialgroup) `GET`
- [分组对应素材列表](#分组对应素材列表--api-collaborative-material-materiallist) `GET`
- [移动系统素材](#移动系统素材--api-collaborative-material-mvsystemmaterial) `POST`
- [【新建|修改】系统素材分组](#新建-修改-系统素材分组--api-collaborative-material-savesystemmaterialgroup) `POST`
- [[新增|修改]系统分组所属业务维护](#新增-修改-系统分组所属业务维护--api-collaborative-material-savesystemresource) `POST`
- [系统分组排序](#系统分组排序--api-collaborative-material-systemmaterialgrouporder) `POST`
- [[新增|修改]系统分组所属业务维护_copy](#新增-修改-系统分组所属业务维护-copy--api-collaborative-material-savesystemresource-1672912458600) `POST`

### 新增系统素材

- **接口ID**: 32082
- **分类**: 素材组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/material/addSystemMaterial`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:03
- **标签**: 素材组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "files": {
      "type": "array",
      "description": "素材内容",
      "items": {
        "properties": {
          "fileId": {
            "type": "string",
            "description": "文件id"
          },
          "fileName": {
            "type": "string",
            "description": "素材名称"
          }
        },
        "$$ref": "#/definitions/MaterialBody"
      }
    },
    "materialGroupId": {
      "type": "string",
      "description": "当前素材所属分类"
    }
  },
  "$$ref": "#/definitions/素材"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result"
}
```

---

### 业务列表

- **接口ID**: 32087
- **分类**: 素材组件接口
- **请求方式**: `GET`
- **路径**: `/api/collaborative/material/allResource`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:03
- **标签**: 素材组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "array",
      "items": {
        "properties": {
          "delete": {
            "type": "boolean"
          },
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "resourceKey": {
            "type": "string"
          }
        },
        "$$ref": "#/definitions/Resource"
      }
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«List«Resource»»"
}
```

---

### 删除系统分组所属业务维护

- **接口ID**: 32092
- **分类**: 素材组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/material/delResource`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:03
- **标签**: 素材组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "id": {
      "type": "string"
    }
  },
  "$$ref": "#/definitions/IdRequest"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result"
}
```

---

### 删除系统素材

- **接口ID**: 32097
- **分类**: 素材组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/material/delSystemMaterial`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:03
- **标签**: 素材组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "ids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "$$ref": "#/definitions/IdsRequest"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result"
}
```

---

### 删除系统分组

- **接口ID**: 32102
- **分类**: 素材组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/material/delSystemMaterialGroup`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:03
- **标签**: 素材组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "id": {
      "type": "string"
    }
  },
  "$$ref": "#/definitions/IdRequest"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result"
}
```

---

### 系统分组列表

- **接口ID**: 32107
- **分类**: 素材组件接口
- **请求方式**: `GET`
- **路径**: `/api/collaborative/material/listSystemMaterialGroup`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-17 15:51:59
- **标签**: 素材组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "array",
      "items": {
        "properties": {
          "businessId": {
            "type": "string",
            "description": "业务标识"
          },
          "groupType": {
            "type": "integer",
            "format": "int32",
            "description": "素材分组类别 0:系统素材 1:业务素材"
          },
          "id": {
            "type": "string",
            "description": "主键"
          },
          "name": {
            "type": "string",
            "description": "分组名称"
          },
          "resourceKey": {
            "type": "array",
            "description": "所属业务",
            "items": {
              "type": "string"
            }
          }
        },
        "$$ref": "#/definitions/素材分组响应",
        "type": "object"
      }
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«List«素材分组响应»»",
  "type": "object"
}
```

---

### 分组对应素材列表

- **接口ID**: 32112
- **分类**: 素材组件接口
- **请求方式**: `GET`
- **路径**: `/api/collaborative/material/materialList`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-17 15:41:29
- **标签**: 素材组件接口

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| id |  | 分组id |  |
| page |  | 页数 |  |
| size |  | 每页展示条数 |  |

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

**响应** (json)

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "success": {
      "type": "boolean"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "number"
    },
    "data": {
      "type": "object",
      "properties": {
        "total": {
          "type": "number"
        },
        "data": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "fileId": {
                "type": "string"
              },
              "fileName": {
                "type": "string"
              },
              "materialGroupId": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "fileId",
              "fileName",
              "materialGroupId"
            ]
          }
        }
      }
    }
  }
}
```

---

### 移动系统素材

- **接口ID**: 32117
- **分类**: 素材组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/material/mvSystemMaterial`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:04
- **标签**: 素材组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "materialGroupId": {
      "type": "string",
      "description": "移动至素材所属分类"
    },
    "materialIds": {
      "type": "array",
      "description": "文件id",
      "items": {
        "type": "string"
      }
    }
  },
  "$$ref": "#/definitions/素材移动"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result"
}
```

---

### 【新建|修改】系统素材分组

- **接口ID**: 32122
- **分类**: 素材组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/material/saveSystemMaterialGroup`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:04
- **标签**: 素材组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "businessId": {
      "type": "string",
      "description": "业务标识"
    },
    "id": {
      "type": "string",
      "description": "主键,有值代表修改.无值代表新增"
    },
    "name": {
      "type": "string",
      "description": "分组名称"
    },
    "order": {
      "type": "integer",
      "format": "int32",
      "description": "排序"
    },
    "resourceKey": {
      "type": "array",
      "description": "所属业务",
      "items": {
        "type": "string"
      }
    }
  },
  "$$ref": "#/definitions/素材分组"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result"
}
```

---

### [新增|修改]系统分组所属业务维护

- **接口ID**: 32127
- **分类**: 素材组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/material/saveSystemResource`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:04
- **标签**: 素材组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "name": {
      "type": "string",
      "description": "业务名称"
    },
    "resourceKey": {
      "type": "string",
      "description": "业务标识"
    }
  },
  "$$ref": "#/definitions/业务"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result"
}
```

---

### 系统分组排序

- **接口ID**: 32132
- **分类**: 素材组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/material/systemMaterialGroupOrder`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:04
- **标签**: 素材组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "ids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "$$ref": "#/definitions/IdsRequest"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result"
}
```

---

### [新增|修改]系统分组所属业务维护_copy

- **接口ID**: 32442
- **分类**: 素材组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/material/saveSystemResource_1672912458600`
- **状态**: undone
- **维护人**: baoding_zhang
- **更新时间**: 2023-01-05 17:54:18
- **标签**: 素材组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "name": {
      "type": "string",
      "description": "业务名称"
    },
    "resourceKey": {
      "type": "string",
      "description": "业务标识"
    }
  },
  "$$ref": "#/definitions/业务"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result"
}
```

---

## 协同组件接口,-opentoken方式 (2)

- [发送消息](#发送消息--api-collaborative-open-component-sendmessage) `POST`
- [分享协作流](#分享协作流--api-collaborative-open-component-share-collaboration) `POST`

### 发送消息

- **接口ID**: 32137
- **分类**: 协同组件接口,-opentoken方式
- **请求方式**: `POST`
- **路径**: `/api/collaborative/open_component/sendMessage`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:04
- **标签**: 协同组件接口,-opentoken方式

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "string"
}
```

**响应** (json)

```json
{
  "type": "string"
}
```

---

### 分享协作流

- **接口ID**: 32142
- **分类**: 协同组件接口,-opentoken方式
- **请求方式**: `POST`
- **路径**: `/api/collaborative/open_component/share_collaboration`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:04
- **标签**: 协同组件接口,-opentoken方式

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "curEid": {
      "type": "string"
    },
    "curOid": {
      "type": "string"
    },
    "groupId": {
      "type": "string",
      "description": "群组id"
    },
    "msgId": {
      "type": "string",
      "description": "消息id"
    },
    "webpageUrl": {
      "type": "string",
      "description": "webpageUrl, 跳转链接， 冗余字段，非必传"
    }
  },
  "$$ref": "#/definitions/分享协作流"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«object»"
}
```

---

## 转发选人桥接口 (4)

- [获取用户信息](#获取用户信息--api-collaborative-bridge-getpersoninfo) `POST`
- [获取无组织人员](#获取无组织人员--api-collaborative-bridge-getpersonsunallot) `POST`
- [搜索人员](#搜索人员--api-collaborative-bridge-searchpersonsinfo) `POST`
- [组织架构树](#组织架构树--api-collaborative-bridge-treeorg) `POST`

### 获取用户信息

- **接口ID**: 31987
- **分类**: 转发选人桥接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/bridge/getPersonInfo`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:00
- **标签**: 转发选人桥接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "string"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "array",
      "items": {
        "properties": {
          "active": {
            "type": "string"
          },
          "activeTime": {
            "type": "string"
          },
          "birthday": {
            "type": "string"
          },
          "companyName": {
            "type": "string"
          },
          "contact": {
            "properties": {
              "privateContact": {
                "type": "array",
                "items": {
                  "properties": {
                    "name": {
                      "type": "string"
                    },
                    "type": {
                      "type": "string"
                    },
                    "value": {
                      "type": "string"
                    }
                  },
                  "$$ref": "#/definitions/PrivateContact"
                }
              },
              "publicContact": {
                "type": "array",
                "items": {
                  "properties": {
                    "publicid": {
                      "type": "string"
                    },
                    "value": {
                      "type": "string"
                    }
                  },
                  "$$ref": "#/definitions/PublicContact"
                }
              }
            },
            "$$ref": "#/definitions/Contact"
          },
          "createTime": {
            "type": "string"
          },
          "department": {
            "type": "string"
          },
          "eid": {
            "type": "string"
          },
          "email": {
            "type": "string"
          },
          "fullPinyin": {
            "type": "string"
          },
          "gender": {
            "type": "string"
          },
          "hide": {
            "type": "boolean"
          },
          "id": {
            "type": "string"
          },
          "isAdmin": {
            "type": "integer",
            "format": "int32"
          },
          "isHidePhone": {
            "type": "integer",
            "format": "int32"
          },
          "jobNo": {
            "type": "string"
          },
          "jobTitle": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "oId": {
            "type": "string"
          },
          "openId": {
            "type": "string"
          },
          "orgId": {
            "type": "string"
          },
          "orgInfoId": {
            "type": "string"
          },
          "phone": {
            "type": "string"
          },
          "photoUrl": {
            "type": "string"
          },
          "registerDate": {
            "type": "string"
          },
          "status": {
            "type": "integer",
            "format": "int32"
          },
          "tid": {
            "type": "string"
          },
          "uid": {
            "type": "string"
          },
          "updateTime": {
            "type": "string"
          },
          "userName": {
            "type": "string"
          },
          "userType": {
            "type": "integer",
            "format": "int32"
          },
          "wbNetworkId": {
            "type": "string"
          },
          "wbUserId": {
            "type": "string"
          },
          "weights": {
            "type": "integer",
            "format": "int32"
          }
        },
        "$$ref": "#/definitions/Person"
      }
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«List«Person»»"
}
```

---

### 获取无组织人员

- **接口ID**: 31992
- **分类**: 转发选人桥接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/bridge/getPersonsUnallot`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:01
- **标签**: 转发选人桥接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "begin": {
      "type": "integer",
      "format": "int32",
      "description": "orgInfoId"
    },
    "count": {
      "type": "integer",
      "format": "int32",
      "description": "orgInfoId"
    }
  },
  "$$ref": "#/definitions/获取架构无组织人员上行信息"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "array",
      "items": {
        "properties": {
          "active": {
            "type": "string"
          },
          "activeTime": {
            "type": "string"
          },
          "birthday": {
            "type": "string"
          },
          "city": {
            "type": "string"
          },
          "companyName": {
            "type": "string"
          },
          "contact": {
            "properties": {
              "privateContact": {
                "type": "array",
                "items": {
                  "properties": {
                    "name": {
                      "type": "string"
                    },
                    "type": {
                      "type": "string"
                    },
                    "value": {
                      "type": "string"
                    }
                  },
                  "$$ref": "#/definitions/YZJPrivateContact"
                }
              },
              "publicContact": {
                "type": "array",
                "items": {
                  "properties": {
                    "publicid": {
                      "type": "string"
                    },
                    "value": {
                      "type": "string"
                    }
                  },
                  "$$ref": "#/definitions/YZJPublicContact"
                }
              }
            },
            "$$ref": "#/definitions/YZJContact"
          },
          "createTime": {
            "type": "string"
          },
          "department": {
            "type": "string"
          },
          "eid": {
            "type": "string"
          },
          "email": {
            "type": "string"
          },
          "fullPinyin": {
            "type": "string"
          },
          "gender": {
            "type": "string"
          },
          "hide": {
            "type": "boolean"
          },
          "hireDate": {
            "type": "string"
          },
          "id": {
            "type": "string"
          },
          "identityId": {
            "type": "string"
          },
          "isAdmin": {
            "type": "integer",
            "format": "int32"
          },
          "isHide": {
            "type": "boolean"
          },
          "isHidePhone": {
            "type": "integer",
            "format": "int32"
          },
          "isResetPwd": {
            "type": "boolean"
          },
          "jobNo": {
            "type": "string"
          },
          "jobTitle": {
            "type": "string"
          },
          "joinDate": {
            "type": "string"
          },
          "leaveDate": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "oId": {
            "type": "string"
          },
          "openId": {
            "type": "string"
          },
          "orgFlagId": {
            "type": "string"
          },
          "orgFlagName": {
            "type": "string"
          },
          "orgId": {
            "type": "string"
          },
          "orgInfoId": {
            "type": "string"
          },
          "phone": {
            "type": "string"
          },
          "photoUrl": {
            "type": "string"
          },
          "positiveDate": {
            "type": "string"
          },
          "provice": {
            "type": "string"
          },
          "registerDate": {
            "type": "string"
          },
          "resetPwd": {
            "type": "boolean"
          },
          "status": {
            "type": "integer",
            "format": "int32"
          },
          "tid": {
            "type": "string"
          },
          "uid": {
            "type": "string"
          },
          "updateTime": {
            "type": "string"
          },
          "userName": {
            "type": "string"
          },
          "userType": {
            "type": "integer",
            "format": "int32"
          },
          "wbNetworkId": {
            "type": "string"
          },
          "wbUserId": {
            "type": "string"
          },
          "weights": {
            "type": "integer",
            "format": "int32"
          }
        },
        "$$ref": "#/definitions/RPerson"
      }
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«List«RPerson»»"
}
```

---

### 搜索人员

- **接口ID**: 31997
- **分类**: 转发选人桥接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/bridge/searchPersonsInfo`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:01
- **标签**: 转发选人桥接口

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| formMap |  | formMap |  |

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

**响应** (json)

```json
{
  "type": "string"
}
```

---

### 组织架构树

- **接口ID**: 32002
- **分类**: 转发选人桥接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/bridge/treeOrg`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:01
- **标签**: 转发选人桥接口

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| formMap |  | formMap |  |

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

**响应** (json)

```json
{
  "type": "string"
}
```

---

## 协同组件接口 (15)

- [新增协同流评论](#新增协同流评论--api-collaborative-coordination-addcoment) `POST`
- [获取协同组件评论列表](#获取协同组件评论列表--api-collaborative-coordination-comentlist) `POST`
- [关联群组](#关联群组--api-collaborative-coordination-creategroup) `POST`
- [关联视频会议](#关联视频会议--api-collaborative-coordination-createvideo) `POST`
- [关联语音会议](#关联语音会议--api-collaborative-coordination-createvoice) `POST`
- [关联日程](#关联日程--api-collaborative-coordination-creatework) `POST`
- [删除协同流评论](#删除协同流评论--api-collaborative-coordination-delcoment) `POST`
- [协作流-获取审批详情](#协作流-获取审批详情--api-collaborative-coordination-getflowinfo) `POST`
- [协同流评论点赞、取消点赞](#协同流评论点赞-取消点赞--api-collaborative-coordination-laud) `POST`
- [拉取群组列表](#拉取群组列表--api-collaborative-coordination-listgroup) `POST`
- [获取协同流评论回复的列表](#获取协同流评论回复的列表--api-collaborative-coordination-listreply) `POST`
- [拉取视频会议数据列表](#拉取视频会议数据列表--api-collaborative-coordination-listvideo) `POST`
- [拉取语音会议数据列表](#拉取语音会议数据列表--api-collaborative-coordination-listvoice) `POST`
- [拉取日程数据列表](#拉取日程数据列表--api-collaborative-coordination-listwork) `POST`
- [创建群组](#创建群组--api-collaborative-coordination-savegroup) `POST`

### 新增协同流评论

- **接口ID**: 32007
- **分类**: 协同组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/coordination/addComent`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:01
- **标签**: 协同组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "atTodoOids": {
      "type": "array",
      "description": "协作流@提及进待办的oids列表, 目前方案为只发公共号",
      "items": {
        "type": "string"
      }
    },
    "atTodoUrl": {
      "type": "string",
      "description": "协作流@提及进待办的跳转链接, 目前方案为只发公共号"
    },
    "attachFiles": {
      "type": "array",
      "items": {
        "properties": {
          "fileName": {
            "type": "string",
            "description": "文件名"
          },
          "fileSize": {
            "type": "string",
            "description": "文件大小"
          },
          "fileUrl": {
            "type": "string",
            "description": "文件地址"
          }
        },
        "$$ref": "#/definitions/评论附加的文件"
      }
    },
    "attachImgs": {
      "type": "array",
      "description": "评论附加的图片url",
      "items": {
        "type": "string"
      }
    },
    "code": {
      "type": "string",
      "description": "表单id的签名code"
    },
    "content": {
      "type": "string",
      "description": "前端生成的卡片实例id，与id对应"
    },
    "params": {
      "type": "string",
      "description": "点赞评论 自定义参数： 高亮数据自定义json字符串参数/转发数据json字符串格式"
    },
    "toCommentId": {
      "type": "string",
      "description": "回复对方评论的Id"
    },
    "toOId": {
      "type": "string",
      "description": "回复对方的OId"
    },
    "toUsername": {
      "type": "string",
      "description": "回复对方的用户名称"
    },
    "transactionId": {
      "type": "string",
      "description": "第三方业务id，该id需要约束，保证唯一。现约束如下： 苍穹appId + 公私有云状态 + 表单id"
    },
    "transactionName": {
      "type": "string",
      "description": "第三方业务的名称，在苍穹里面则是表单名称"
    }
  },
  "$$ref": "#/definitions/添加评论或回复信息"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "string"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«string»"
}
```

---

### 获取协同组件评论列表

- **接口ID**: 32012
- **分类**: 协同组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/coordination/comentList`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:01
- **标签**: 协同组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "code": {
      "type": "string",
      "description": "表单id的签名code"
    },
    "count": {
      "type": "integer",
      "format": "int32",
      "description": "指定id 之前的拉取内容数量, 默认 20 条"
    },
    "id": {
      "type": "string",
      "description": "上一批协同流最后一条内容的 id"
    },
    "transactionId": {
      "type": "string",
      "description": "第三方业务id，该id需要约束，保证唯一。现约束如下： 苍穹appId + 公私有云状态 + 表单id"
    }
  },
  "$$ref": "#/definitions/获取评论列表参数"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object",
      "additionalProperties": {
        "type": "object"
      }
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«JSONObject»"
}
```

---

### 关联群组

- **接口ID**: 32017
- **分类**: 协同组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/coordination/createGroup`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:01
- **标签**: 协同组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "code": {
      "type": "string",
      "description": "表单id的签名code"
    },
    "coordinationId": {
      "type": "string",
      "description": "协同业务id ， 如日程id，会议id， 群组groupId"
    },
    "eid": {
      "type": "string"
    },
    "oid": {
      "type": "string"
    },
    "transactionId": {
      "type": "string",
      "description": "第三方业务id，该id需要约束，保证唯一。现约束如下： 苍穹appId + 公私有云状态 + 表单id"
    },
    "type": {
      "type": "string"
    }
  },
  "$$ref": "#/definitions/关联业务数据"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "string"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«string»"
}
```

---

### 关联视频会议

- **接口ID**: 32022
- **分类**: 协同组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/coordination/createVideo`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:01
- **标签**: 协同组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "code": {
      "type": "string",
      "description": "表单id的签名code"
    },
    "coordinationId": {
      "type": "string",
      "description": "协同业务id ， 如日程id，会议id， 群组groupId"
    },
    "eid": {
      "type": "string"
    },
    "oid": {
      "type": "string"
    },
    "transactionId": {
      "type": "string",
      "description": "第三方业务id，该id需要约束，保证唯一。现约束如下： 苍穹appId + 公私有云状态 + 表单id"
    },
    "type": {
      "type": "string"
    }
  },
  "$$ref": "#/definitions/关联业务数据"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "string"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«string»"
}
```

---

### 关联语音会议

- **接口ID**: 32027
- **分类**: 协同组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/coordination/createVoice`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:01
- **标签**: 协同组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "code": {
      "type": "string",
      "description": "表单id的签名code"
    },
    "coordinationId": {
      "type": "string",
      "description": "协同业务id ， 如日程id，会议id， 群组groupId"
    },
    "eid": {
      "type": "string"
    },
    "oid": {
      "type": "string"
    },
    "transactionId": {
      "type": "string",
      "description": "第三方业务id，该id需要约束，保证唯一。现约束如下： 苍穹appId + 公私有云状态 + 表单id"
    },
    "type": {
      "type": "string"
    }
  },
  "$$ref": "#/definitions/关联业务数据"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "string"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«string»"
}
```

---

### 关联日程

- **接口ID**: 32032
- **分类**: 协同组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/coordination/createWork`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:01
- **标签**: 协同组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "code": {
      "type": "string",
      "description": "表单id的签名code"
    },
    "coordinationId": {
      "type": "string",
      "description": "协同业务id ， 如日程id，会议id， 群组groupId"
    },
    "eid": {
      "type": "string"
    },
    "oid": {
      "type": "string"
    },
    "transactionId": {
      "type": "string",
      "description": "第三方业务id，该id需要约束，保证唯一。现约束如下： 苍穹appId + 公私有云状态 + 表单id"
    },
    "type": {
      "type": "string"
    }
  },
  "$$ref": "#/definitions/关联业务数据"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "string"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«string»"
}
```

---

### 删除协同流评论

- **接口ID**: 32037
- **分类**: 协同组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/coordination/delComent`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:02
- **标签**: 协同组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "code": {
      "type": "string",
      "description": "表单id的签名code"
    },
    "commentId": {
      "type": "string",
      "description": "待删除的评论Id"
    },
    "transactionId": {
      "type": "string",
      "description": "第三方业务id，该id需要约束，保证唯一。现约束如下： 苍穹appId + 公私有云状态 + 表单id"
    }
  },
  "$$ref": "#/definitions/删除协同流评论"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "string"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«string»"
}
```

---

### 协作流-获取审批详情

- **接口ID**: 32042
- **分类**: 协同组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/coordination/getFlowInfo`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:02
- **标签**: 协同组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "dsId": {
      "type": "string",
      "description": "数据源id 没有可以不传"
    },
    "dsType": {
      "type": "string",
      "description": "数据源类型：智能审批 cloudflow 星空 xingkong"
    },
    "formId": {
      "type": "string",
      "description": "表单id 必传"
    },
    "modelCode": {
      "type": "string",
      "description": "模型id 必传"
    }
  },
  "$$ref": "#/definitions/协作流-获取审批详情"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result"
}
```

---

### 协同流评论点赞、取消点赞

- **接口ID**: 32047
- **分类**: 协同组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/coordination/laud`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:02
- **标签**: 协同组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "code": {
      "type": "string",
      "description": "表单id的签名code"
    },
    "commentId": {
      "type": "string",
      "description": "点赞的评论Id"
    },
    "laud": {
      "type": "boolean",
      "description": "true 点赞； false 取消点赞"
    },
    "transactionId": {
      "type": "string",
      "description": "第三方业务id，该id需要约束，保证唯一。现约束如下： 苍穹appId + 公私有云状态 + 表单id"
    }
  },
  "$$ref": "#/definitions/协同流评论点赞、取消点赞"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "string"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«string»"
}
```

---

### 拉取群组列表

- **接口ID**: 32052
- **分类**: 协同组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/coordination/listGroup`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:02
- **标签**: 协同组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "code": {
      "type": "string",
      "description": "表单id的签名code"
    },
    "coordinationId": {
      "type": "string",
      "description": "当前已有数据最新的业务id(获取业务Id以后创建的数据,只有创建后立马获取才需传!)"
    },
    "transactionId": {
      "type": "string",
      "description": "第三方业务id，该id需要约束，保证唯一。现约束如下： 苍穹appId + 公私有云状态 + 表单id"
    }
  },
  "$$ref": "#/definitions/拉取业务数据列表"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«object»"
}
```

---

### 获取协同流评论回复的列表

- **接口ID**: 32057
- **分类**: 协同组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/coordination/listReply`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:02
- **标签**: 协同组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "code": {
      "type": "string",
      "description": "表单id的签名code"
    },
    "commentId": {
      "type": "string",
      "description": "主评论Id"
    },
    "replyId": {
      "type": "string",
      "description": "回复的commentId"
    },
    "transactionId": {
      "type": "string",
      "description": "第三方业务id，该id需要约束，保证唯一。现约束如下： 苍穹appId + 公私有云状态 + 表单id"
    }
  },
  "$$ref": "#/definitions/获取协同流评论回复的参数"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object",
      "additionalProperties": {
        "type": "object"
      }
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«JSONObject»"
}
```

---

### 拉取视频会议数据列表

- **接口ID**: 32062
- **分类**: 协同组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/coordination/listVideo`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:02
- **标签**: 协同组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "code": {
      "type": "string",
      "description": "表单id的签名code"
    },
    "coordinationId": {
      "type": "string",
      "description": "当前已有数据最新的业务id(获取业务Id以后创建的数据,只有创建后立马获取才需传!)"
    },
    "transactionId": {
      "type": "string",
      "description": "第三方业务id，该id需要约束，保证唯一。现约束如下： 苍穹appId + 公私有云状态 + 表单id"
    }
  },
  "$$ref": "#/definitions/拉取业务数据列表"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«object»"
}
```

---

### 拉取语音会议数据列表

- **接口ID**: 32067
- **分类**: 协同组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/coordination/listVoice`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:02
- **标签**: 协同组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "code": {
      "type": "string",
      "description": "表单id的签名code"
    },
    "coordinationId": {
      "type": "string",
      "description": "当前已有数据最新的业务id(获取业务Id以后创建的数据,只有创建后立马获取才需传!)"
    },
    "transactionId": {
      "type": "string",
      "description": "第三方业务id，该id需要约束，保证唯一。现约束如下： 苍穹appId + 公私有云状态 + 表单id"
    }
  },
  "$$ref": "#/definitions/拉取业务数据列表"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«object»"
}
```

---

### 拉取日程数据列表

- **接口ID**: 32072
- **分类**: 协同组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/coordination/listWork`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:02
- **标签**: 协同组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "code": {
      "type": "string",
      "description": "表单id的签名code"
    },
    "coordinationId": {
      "type": "string",
      "description": "当前已有数据最新的业务id(获取业务Id以后创建的数据,只有创建后立马获取才需传!)"
    },
    "transactionId": {
      "type": "string",
      "description": "第三方业务id，该id需要约束，保证唯一。现约束如下： 苍穹appId + 公私有云状态 + 表单id"
    }
  },
  "$$ref": "#/definitions/拉取业务数据列表"
}
```

**响应** (json)

```json
{
  "properties": {
    "data": {
      "type": "object"
    },
    "error": {
      "type": "string"
    },
    "errorCode": {
      "type": "integer",
      "format": "int32"
    },
    "success": {
      "type": "boolean"
    }
  },
  "$$ref": "#/definitions/Result«object»"
}
```

---

### 创建群组

- **接口ID**: 32077
- **分类**: 协同组件接口
- **请求方式**: `POST`
- **路径**: `/api/collaborative/coordination/saveGroup`
- **状态**: undone
- **维护人**: zhannan_deng
- **更新时间**: 2022-12-14 16:20:02
- **标签**: 协同组件接口

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "properties": {
    "bannerClickUrl": {
      "type": "string",
      "description": "群主题点击跳转链接"
    },
    "bannerContent": {
      "type": "string",
      "description": "群主题内容（在新样式模式下表示次要内容）"
    },
    "bannerPrimaryContent": {
      "type": "string",
      "description": "群主题主要内容"
    },
    "bannerTitle": {
      "type": "string",
      "description": "群主题"
    },
    "classifyNameCode": {
      "type": "string",
      "description": "组名编码 1:苍穹业务群组,2:星空业务群组"
    },
    "contentUrl": {
      "type": "string",
      "description": "内容图表url，有此值时优先显示图表"
    },
    "groupName": {
      "type": "string"
    },
    "lightAppId": {
      "type": "string",
      "description": "群主题对应的appId"
    },
    "oids": {
      "type": "array",
      "description": "oids",
      "items": {
        "type": "string"
      }
    },
    "share": {
      "type": "boolean",
      "description": "群是否有右键分享协作流功能"
    },
    "thumbUrl": {
      "type": "string",
      "description": "缩略图url"
    }
  },
  "$$ref": "#/definitions/群组"
}
```

**响应** (json)

```json
{
  "type": "string"
}
```

---
