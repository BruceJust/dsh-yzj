# work-wechat-service (pid=349)

- **basepath**: `/workwechat`
- **接口总数**: 12

## 微信APP (1)

- [保存微信App信息](#保存微信app信息--workwechat-wechat-app-save) `POST`

### 保存微信App信息

- **接口ID**: 45795
- **分类**: 微信APP
- **请求方式**: `POST`
- **路径**: `/workwechat/wechat/app/save`
- **状态**: undone
- **维护人**: zhujun_lu
- **更新时间**: 2024-12-12 16:18:01
- **标签**: 微信APP

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| appid |  | appid |  |
| secret |  | secret |  |

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

**响应** (json)

```json
{
  "type": "object",
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
  "title": "Result«string»",
  "$$ref": "#/definitions/Result«string»"
}
```

---

## 微信用户鉴权 (11)

- [获取用户oid](#获取用户oid--workwechat-wechat-auth-getoidbywechatticket) `GET`
- [微信用户鉴权(h5)](#微信用户鉴权-h5---workwechat-wechat-auth-h5) `GET`
- [微信用户鉴权(小程序)](#微信用户鉴权-小程序---workwechat-wechat-auth-mini) `GET`
- [获取微信accessToken(小程序)](#获取微信accesstoken-小程序---workwechat-wechat-auth-mini-accesstoken) `GET`
- [注册用户(手机验证码)](#注册用户-手机验证码---workwechat-wechat-auth-registereduserwithphonecheckcode) `GET`
- [注册用户(微信手机号)](#注册用户-微信手机号---workwechat-wechat-auth-registereduserwithwechatphone) `GET`
- [发送短信验证码](#发送短信验证码--workwechat-wechat-auth-sendcheckcode) `GET`
- [微信发送模板消息(小程序)](#微信发送模板消息-小程序---workwechat-wechat-auth-mini-sendtemplatemessage) `POST`
- [注册用户(手机验证码)](#注册用户-手机验证码---workwechat-wechat-auth-web-bind) `POST`
- [微信用户鉴权(web)](#微信用户鉴权-web---workwechat-wechat-auth-web-login) `POST`
- [发送短信验证码](#发送短信验证码--workwechat-wechat-auth-web-sendphonecode) `POST`

### 获取用户oid

- **接口ID**: 45798
- **分类**: 微信用户鉴权
- **请求方式**: `GET`
- **路径**: `/workwechat/wechat/auth/getOidByWechatTicket`
- **状态**: undone
- **维护人**: zhujun_lu
- **更新时间**: 2024-12-12 16:18:01
- **标签**: 微信用户鉴权

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| wechatTicket |  | wechatTicket |  |

**响应** (json)

```json
{
  "type": "object",
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
  "title": "Result«string»",
  "$$ref": "#/definitions/Result«string»"
}
```

---

### 微信用户鉴权(h5)

- **接口ID**: 45801
- **分类**: 微信用户鉴权
- **请求方式**: `GET`
- **路径**: `/workwechat/wechat/auth/h5`
- **状态**: undone
- **维护人**: zhujun_lu
- **更新时间**: 2024-12-12 16:18:01
- **标签**: 微信用户鉴权

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| appid |  | appid |  |
| code |  | code |  |

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "data": {
      "type": "object",
      "properties": {
        "wechatOpenid": {
          "type": "string",
          "description": "微信openid"
        },
        "wechatSessionKey": {
          "type": "string",
          "description": "微信sessionKey"
        },
        "wechatTicket": {
          "type": "string",
          "description": "微信ticket"
        }
      },
      "title": "微信鉴权",
      "$$ref": "#/definitions/微信鉴权"
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
  "title": "Result«微信鉴权»",
  "$$ref": "#/definitions/Result«微信鉴权»"
}
```

---

### 微信用户鉴权(小程序)

- **接口ID**: 45804
- **分类**: 微信用户鉴权
- **请求方式**: `GET`
- **路径**: `/workwechat/wechat/auth/mini`
- **状态**: undone
- **维护人**: zhujun_lu
- **更新时间**: 2024-12-12 16:18:01
- **标签**: 微信用户鉴权

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| appid |  | appid |  |
| code |  | code |  |

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "data": {
      "type": "object",
      "properties": {
        "wechatOpenid": {
          "type": "string",
          "description": "微信openid"
        },
        "wechatSessionKey": {
          "type": "string",
          "description": "微信sessionKey"
        },
        "wechatTicket": {
          "type": "string",
          "description": "微信ticket"
        }
      },
      "title": "微信鉴权",
      "$$ref": "#/definitions/微信鉴权"
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
  "title": "Result«微信鉴权»",
  "$$ref": "#/definitions/Result«微信鉴权»"
}
```

---

### 获取微信accessToken(小程序)

- **接口ID**: 45807
- **分类**: 微信用户鉴权
- **请求方式**: `GET`
- **路径**: `/workwechat/wechat/auth/mini/accessToken`
- **状态**: undone
- **维护人**: zhujun_lu
- **更新时间**: 2024-12-12 16:18:01
- **标签**: 微信用户鉴权

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| appid |  | appid |  |

**响应** (json)

```json
{
  "type": "object",
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
  "title": "Result«string»",
  "$$ref": "#/definitions/Result«string»"
}
```

---

### 注册用户(手机验证码)

- **接口ID**: 45810
- **分类**: 微信用户鉴权
- **请求方式**: `GET`
- **路径**: `/workwechat/wechat/auth/registeredUserWithPhoneCheckCode`
- **状态**: undone
- **维护人**: zhujun_lu
- **更新时间**: 2024-12-12 16:18:01
- **标签**: 微信用户鉴权

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| appid |  | appid |  |
| checkCode |  | checkCode |  |
| phone |  | phone |  |
| wechatOpenid |  | wechatOpenid |  |

**响应** (json)

```json
{
  "type": "object",
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
  "title": "Result«string»",
  "$$ref": "#/definitions/Result«string»"
}
```

---

### 注册用户(微信手机号)

- **接口ID**: 45813
- **分类**: 微信用户鉴权
- **请求方式**: `GET`
- **路径**: `/workwechat/wechat/auth/registeredUserWithWechatPhone`
- **状态**: undone
- **维护人**: zhujun_lu
- **更新时间**: 2024-12-12 16:18:01
- **标签**: 微信用户鉴权

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| appid |  | appid |  |
| encryptedData |  | encryptedData |  |
| sessionKey |  | sessionKey |  |
| vi |  | vi |  |
| wechatOpenid |  | wechatOpenid |  |

**响应** (json)

```json
{
  "type": "object",
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
  "title": "Result«string»",
  "$$ref": "#/definitions/Result«string»"
}
```

---

### 发送短信验证码

- **接口ID**: 45816
- **分类**: 微信用户鉴权
- **请求方式**: `GET`
- **路径**: `/workwechat/wechat/auth/sendCheckCode`
- **状态**: undone
- **维护人**: zhujun_lu
- **更新时间**: 2024-12-12 16:18:01
- **标签**: 微信用户鉴权

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| phone |  | phone |  |

**响应** (json)

```json
{
  "type": "object",
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
  "title": "Result«string»",
  "$$ref": "#/definitions/Result«string»"
}
```

---

### 微信发送模板消息(小程序)

- **接口ID**: 45819
- **分类**: 微信用户鉴权
- **请求方式**: `POST`
- **路径**: `/workwechat/wechat/auth/mini/sendTemplateMessage`
- **状态**: undone
- **维护人**: zhujun_lu
- **更新时间**: 2024-12-12 16:18:01
- **标签**: 微信用户鉴权

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "appid": {
      "type": "string"
    },
    "data": {
      "type": "object"
    },
    "emphasisKeyword": {
      "type": "string"
    },
    "formId": {
      "type": "string"
    },
    "page": {
      "type": "string"
    },
    "templateId": {
      "type": "string"
    },
    "touser": {
      "type": "string"
    }
  },
  "title": "WechatTemplateMessage",
  "$$ref": "#/definitions/WechatTemplateMessage"
}
```

**响应** (json)

```json
{
  "type": "object",
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
  "title": "Result«string»",
  "$$ref": "#/definitions/Result«string»"
}
```

---

### 注册用户(手机验证码)

- **接口ID**: 45822
- **分类**: 微信用户鉴权
- **请求方式**: `POST`
- **路径**: `/workwechat/wechat/auth/web/bind`
- **状态**: undone
- **维护人**: zhujun_lu
- **更新时间**: 2024-11-21 19:40:01
- **标签**: 微信用户鉴权

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

```json
{
  "type": "object",
  "properties": {
    "bindToken": {
      "type": "string"
    },
    "phone": {
      "type": "string"
    },
    "phoneCode": {
      "type": "string"
    }
  },
  "title": "WechatBindVo",
  "$$ref": "#/definitions/WechatBindVo"
}
```

**响应** (json)

```json
{
  "type": "object",
  "properties": {
    "data": {
      "type": "object",
      "properties": {
        "bindToken": {
          "type": "string",
          "description": "用于绑定微信账号的token"
        },
        "url": {
          "type": "string",
          "description": "跳转url"
        },
        "wechatOpenid": {
          "type": "string",
          "description": "微信openid"
        },
        "wechatSessionKey": {
          "type": "string",
          "description": "微信sessionKey"
        },
        "wechatTicket": {
          "type": "string",
          "description": "微信ticket"
        }
      },
      "title": "微信鉴权",
      "$$ref": "#/definitions/微信鉴权"
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
  "title": "Result«微信鉴权»",
  "$$ref": "#/definitions/Result«微信鉴权»"
}
```

---

### 微信用户鉴权(web)

- **接口ID**: 45825
- **分类**: 微信用户鉴权
- **请求方式**: `POST`
- **路径**: `/workwechat/wechat/auth/web/login`
- **状态**: undone
- **维护人**: zhujun_lu
- **更新时间**: 2024-11-21 19:40:01
- **标签**: 微信用户鉴权

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| appId |  | 云之家appid |  |
| code |  | 微信单点返回的CODE |  |
| deviceType |  | 终端类型,对应lappAccess、1：移动端，2：web端，3：桌面端 |  |
| rebind |  | 是否重新绑定账号 |  |
| redirectUrl |  | 应用URL |  |
| wxAppId |  | 微信appId |  |

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
  "type": "object",
  "properties": {
    "data": {
      "type": "object",
      "properties": {
        "bindToken": {
          "type": "string",
          "description": "用于绑定微信账号的token"
        },
        "url": {
          "type": "string",
          "description": "跳转url"
        },
        "wechatOpenid": {
          "type": "string",
          "description": "微信openid"
        },
        "wechatSessionKey": {
          "type": "string",
          "description": "微信sessionKey"
        },
        "wechatTicket": {
          "type": "string",
          "description": "微信ticket"
        }
      },
      "title": "微信鉴权",
      "$$ref": "#/definitions/微信鉴权"
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
  "title": "Result«微信鉴权»",
  "$$ref": "#/definitions/Result«微信鉴权»"
}
```

---

### 发送短信验证码

- **接口ID**: 45834
- **分类**: 微信用户鉴权
- **请求方式**: `POST`
- **路径**: `/workwechat/wechat/auth/web/sendPhoneCode`
- **状态**: undone
- **维护人**: zhujun_lu
- **更新时间**: 2024-11-21 19:40:01
- **标签**: 微信用户鉴权

**Query 参数**

| name | required(必填) | desc | example |
|---|---|---|---|
| phone |  | phone |  |

**Headers**

| name | value | required(必填) | desc |
|---|---|---|---|
| Content-Type | application/json |  |  |

**请求 Body (json)**

**响应** (json)

```json
{
  "type": "object",
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
  "title": "Result«string»",
  "$$ref": "#/definitions/Result«string»"
}
```

---
