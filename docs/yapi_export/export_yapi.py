#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 YApi (yapi.yzjop.com) 分组 393 全量导出所有项目接口。
输出: yapi_export/<pid>_<项目名>.json (原始全量) + .md (可读版) + SUMMARY.md
"""
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "http://yapi.yzjop.com"
COOKIE = "_yapi_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjEyMjQsImlhdCI6MTc4NzIxMzUwOSwiZXhwIjoxNzg3ODE4MzA5fQ.8b81dqisIXYL1Z6RIZ-jAvKwQSyFEGL3SC8c3Grt5Pg; _yapi_uid=1224"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

PROJECTS = [
    (455, "livestream"),
    (417, "日程V12开放平台API"),
    (391, "workassistant-ai-agent"),
    (349, "work-wechat-service"),
    (107, "collaborative-component"),
    (38, "workreport-form-service"),
    (37, "workreport"),
    (15, "workassistant-service"),
]

STATUS_MAP = {0: " undone(设计)", 1: " done(完成)", 2: " deprecated(废弃)"}
METHODS = {}


def http_get_json(url, retries=3):
    last_err = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"Cookie": COOKIE})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(1 + i)
    raise RuntimeError("GET %s failed: %s" % (url, last_err))


def fetch_menu(pid):
    d = http_get_json("%s/api/interface/list_menu?project_id=%s" % (BASE, pid))
    if d.get("errcode") != 0:
        raise RuntimeError("list_menu pid=%s: %s" % (pid, d.get("errmsg")))
    return d["data"]


def fetch_interface(iid):
    d = http_get_json("%s/api/interface/get?id=%s" % (BASE, iid))
    if d.get("errcode") != 0:
        return {"_id": iid, "_error": d.get("errmsg")}
    return d["data"]


def fmt_json(text):
    if not text:
        return None
    try:
        return json.dumps(json.loads(text), ensure_ascii=False, indent=2)
    except Exception:  # noqa: BLE001
        return text


def kv_table(items, name_key, keys):
    """渲染 [{name, required, desc, example}] 为 markdown 表格"""
    rows = []
    for it in items or []:
        if not it.get(name_key):
            continue
        vals = []
        for k in keys:
            v = it.get(k)
            if isinstance(v, bool):
                v = "是" if v else "否"
            vals.append(str(v if v is not None else "").replace("\n", "<br>").replace("|", "\\|"))
        rows.append(vals)
    if not rows:
        return None
    lines = ["| %s |" % " | ".join(keys), "|" + "|".join(["---"] * len(keys)) + "|"]
    for r in rows:
        lines.append("| %s |" % " | ".join(r))
    return "\n".join(lines)


def render_interface(it, cat_name, project_name, basepath):
    md = []
    title = it.get("title") or "(未命名)"
    method = (it.get("method") or "GET").upper()
    path = it.get("path") or ""
    iid = it.get("_id")
    md.append("### %s\n" % title)
    md.append("- **接口ID**: %s" % iid)
    md.append("- **分类**: %s" % cat_name)
    md.append("- **请求方式**: `%s`" % method)
    md.append("- **路径**: `%s%s`" % (basepath or "", path))
    st = STATUS_MAP.get(it.get("status"), str(it.get("status")))
    md.append("- **状态**: %s" % st.strip())
    if it.get("username"):
        md.append("- **维护人**: %s" % it.get("username"))
    if it.get("up_time"):
        md.append("- **更新时间**: %s" % time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(it["up_time"])))
    if it.get("tag"):
        md.append("- **标签**: %s" % ", ".join(it["tag"]))
    md.append("")

    desc = (it.get("desc") or "").strip()
    if desc and desc not in ("<p><br></p>", "<p></p>"):
        md.append("**说明**\n\n%s\n" % desc)

    # path params
    tp = kv_table(it.get("req_params"), "name", ["name", "desc", "example"])
    if tp:
        md.append("**路径参数**\n\n%s\n" % tp)

    q = kv_table(it.get("req_query"), "name", ["name", "required(必填)", "desc", "example"])
    if q:
        md.append("**Query 参数**\n\n%s\n" % q)

    h = kv_table(it.get("req_headers"), "name", ["name", "value", "required(必填)", "desc"])
    if h:
        md.append("**Headers**\n\n%s\n" % h)

    # body
    body_type = it.get("req_body_type")
    if body_type == "form":
        f = kv_table(it.get("req_body_form"), "name", ["name", "type", "required(必填)", "desc", "example"])
        if f:
            md.append("**请求 Body (form)**\n\n%s\n" % f)
    elif body_type == "json":
        md.append("**请求 Body (json)**\n")
        if it.get("req_body_other"):
            j = fmt_json(it["req_body_other"])
            if j:
                md.append("```json\n%s\n```\n" % j)

    # response
    res_type = it.get("res_body_type")
    if it.get("res_body"):
        md.append("**响应** (%s)\n" % (res_type or "json"))
        j = fmt_json(it["res_body"])
        if j:
            lang = "json" if res_type in (None, "json") else ""
            md.append("```%s\n%s\n```\n" % (lang, j))

    link = "%s/project/%s/interface/api/%s" % (BASE, it.get("project_id", ""), iid)
    md.append("---\n")
    return "\n".join(md), (method, (basepath or "") + path, title, cat_name, project_name, st.strip())


def render_project(raw):
    """从 raw dict(含接口详情) 渲染 markdown，返回 (md_lines, index, errs)"""
    pid, pname = raw["projectId"], raw["projectName"]
    basepath = raw.get("basepath") or ""
    pdesc = (raw.get("desc") or "").strip()
    cats = raw.get("categories") or []
    total = sum(len(c.get("interfaces") or []) for c in cats)
    md_lines = [
        "# %s (pid=%s)\n" % (pname, pid),
        "- **basepath**: `%s`" % basepath,
        "- **接口总数**: %d" % total,
    ]
    if pdesc:
        md_lines.append("- **项目说明**: %s" % pdesc)
    md_lines.append("")

    index = []
    errs = 0
    for cat in cats:
        items = cat.get("interfaces") or []
        if not items:
            continue
        cat_name = cat.get("name") or "(未分类)"
        md_lines.append("## %s (%d)\n" % (cat_name, len(items)))
        # 接口索引
        for r in items:
            m = (r.get("method") or "GET").upper()
            p = (basepath or "") + (r.get("path") or "")
            t = r.get("title") or "(未命名)"
            anchor = ("%s-%s" % (t, p)).lower()
            anchor = "".join(c if c.isalnum() or c in "一二三四五六七八九十百千万亿" else "-" for c in anchor)
            md_lines.append("- [%s](#%s) `%s`" % (t, anchor.strip("-"), m))
        md_lines.append("")
        for r in items:
            if "_error" in r:
                errs += 1
                md_lines.append("### (导出失败 id=%s)\n\n%s\n\n---\n" % (r.get("_id"), r["_error"]))
                index.append(("?", "?", r.get("title", "?"), cat_name, pname, "?"))
                continue
            body, idx = render_interface(r, cat_name, pname, basepath)
            md_lines.append(body)
            index.append(idx)
    return md_lines, index, errs


def export_project(pid, pname):
    print("[pid=%s] %s: fetching menu ..." % (pid, pname))
    menu = fetch_menu(pid)
    # project detail for basepath
    pd = http_get_json("%s/api/project/get?id=%s" % (BASE, pid))
    basepath = ""
    if pd.get("errcode") == 0:
        basepath = pd["data"].get("basepath") or ""
    pdesc = ""
    if pd.get("errcode") == 0:
        pdesc = (pd["data"].get("desc") or "").strip()

    tasks = []
    for cat in menu:
        for it in cat.get("list") or []:
            tasks.append((cat, it))
    print("[pid=%s] %s: %d interfaces to fetch" % (pid, pname, len(tasks)))

    results = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(fetch_interface, it["_id"]): it["_id"] for _, it in tasks}
        done = 0
        for f in as_completed(futs):
            iid = futs[f]
            try:
                results[iid] = f.result()
            except Exception as e:  # noqa: BLE001
                results[iid] = {"_id": iid, "_error": str(e)}
            done += 1
            if done % 50 == 0:
                print("  [pid=%s] %d/%d fetched" % (pid, done, len(tasks)))

    # build raw json (cat -> interface detail)
    raw = {
        "projectId": pid,
        "projectName": pname,
        "basepath": basepath,
        "desc": pdesc,
        "categories": [],
    }
    for cat in menu:
        items = cat.get("list") or []
        if not items:
            continue
        cat_name = cat.get("name") or "(未分类)"
        raw["categories"].append({
            "name": cat_name,
            "desc": cat.get("desc") or "",
            "interfaces": [results.get(it["_id"]) for it in items],
        })

    safe_name = "%d_%s" % (pid, pname.replace("/", "-").replace(" ", ""))
    json_path = os.path.join(OUT_DIR, safe_name + ".json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(raw, f, ensure_ascii=False, indent=1)

    md_lines, index, errs = render_project(raw)
    md_path = os.path.join(OUT_DIR, safe_name + ".md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))
    print("[pid=%s] %s: done -> %s, %s (errors=%d)" % (pid, pname, json_path, md_path, errs))
    return {"pid": pid, "name": pname, "count": len(tasks), "errors": errs,
            "md": safe_name + ".md", "json": safe_name + ".json", "index": index}


def write_summary(all_stats):
    sm = ["# YApi 分组 393 接口全量导出汇总\n",
          "> 来源: %s/group/393 ，导出时间: %s\n" % (BASE, time.strftime("%Y-%m-%d %H:%M:%S")),
          "## 项目总览\n",
          "| 项目ID | 项目名 | 接口数 | 导出失败 | Markdown | 原始JSON |",
          "|---|---|---|---|---|---|"]
    total = 0
    total_err = 0
    for s in all_stats:
        total += s["count"]
        total_err += max(0, s["errors"])
        sm.append("| %s | %s | %s | %s | [%s](%s) | [%s](%s) |" % (
            s["pid"], s["name"], s["count"], max(0, s["errors"]),
            s.get("md", "-"), s.get("md", ""), s.get("json", "-"), s.get("json", "")))
    sm.append("| **合计** | | **%d** | **%d** | | |\n" % (total, total_err))

    for s in all_stats:
        if not s["index"]:
            continue
        sm.append("## %s (pid=%s) 接口清单\n" % (s["name"], s["pid"]))
        sm.append("| 方法 | 路径 | 标题 | 分类 | 状态 |")
        sm.append("|---|---|---|---|---|")
        for m, p, t, c, pn, st in s["index"]:
            sm.append("| %s | `%s` | %s | %s | %s |" % (m, p, t, c, st))
        sm.append("")
    with open(os.path.join(OUT_DIR, "SUMMARY.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(sm))
    return total, total_err


def rerender_all():
    """从本地已导出的 JSON 重新渲染 Markdown 与 SUMMARY（不请求网络）"""
    all_stats = []
    for pid, pname in PROJECTS:
        safe_name = "%d_%s" % (pid, pname.replace("/", "-").replace(" ", ""))
        json_path = os.path.join(OUT_DIR, safe_name + ".json")
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            md_lines, index, errs = render_project(raw)
            md_path = os.path.join(OUT_DIR, safe_name + ".md")
            with open(md_path, "w", encoding="utf-8") as f:
                f.write("\n".join(md_lines))
            count = sum(len(c.get("interfaces") or []) for c in raw.get("categories") or [])
            all_stats.append({"pid": pid, "name": pname, "count": count, "errors": errs,
                              "md": safe_name + ".md", "json": safe_name + ".json", "index": index})
            print("[pid=%s] rerendered -> %s (errors=%d)" % (pid, md_path, errs))
        except Exception as e:  # noqa: BLE001
            print("[pid=%s] RERENDER FAILED: %s" % (pid, e), file=sys.stderr)
            all_stats.append({"pid": pid, "name": pname, "count": 0, "errors": -1,
                              "index": [], "error": str(e)})
    return all_stats


def main():
    if "--rerender" in sys.argv:
        all_stats = rerender_all()
    else:
        all_stats = []
        for pid, pname in PROJECTS:
            try:
                all_stats.append(export_project(pid, pname))
            except Exception as e:  # noqa: BLE001
                print("[pid=%s] FAILED: %s" % (pid, e), file=sys.stderr)
                all_stats.append({"pid": pid, "name": pname, "count": 0, "errors": -1,
                                  "index": [], "error": str(e)})
    total, total_err = write_summary(all_stats)
    print("\nALL DONE. total=%d errors=%d" % (total, total_err))


if __name__ == "__main__":
    main()
