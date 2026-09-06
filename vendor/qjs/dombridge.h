/* dombridge.h — thin C shim over QuickJS-ng for the machin FFI spike.
 *
 * Proves the make-or-break architecture question for a machin browser engine:
 * can MFL host a JS engine, expose a host-side DOM to it, run real JS that
 * mutates that DOM, and read the result back?
 *
 * All JSValue-by-value marshaling is hidden here; MFL sees only ptr/string.
 * The host "DOM" is a tiny fixed key->value store. JS reaches it through a
 * global `dom` object with dom.get(id) / dom.set(id, val), each backed by a
 * native C function that reads/writes the host store. That is exactly the
 * binding a real engine needs, in miniature.
 */
#ifndef DOMBRIDGE_H
#define DOMBRIDGE_H
#include "quickjs.h"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

#define DB_MAX_NODES 64
#define DB_KEYLEN 64
#define DB_VALLEN 1024

typedef struct { char id[DB_KEYLEN]; char val[DB_VALLEN]; int used; } DbNode;
typedef struct { JSRuntime *rt; JSContext *ctx; DbNode nodes[DB_MAX_NODES]; } DbEngine;

static DbNode *db_find(DbEngine *e, const char *id) {
    for (int i = 0; i < DB_MAX_NODES; i++)
        if (e->nodes[i].used && strcmp(e->nodes[i].id, id) == 0) return &e->nodes[i];
    return NULL;
}
static DbNode *db_intern(DbEngine *e, const char *id) {
    DbNode *n = db_find(e, id);
    if (n) return n;
    for (int i = 0; i < DB_MAX_NODES; i++) if (!e->nodes[i].used) {
        e->nodes[i].used = 1;
        strncpy(e->nodes[i].id, id, DB_KEYLEN - 1);
        e->nodes[i].val[0] = 0;
        return &e->nodes[i];
    }
    return NULL;
}

/* native: dom.get(id) -> string ("" if unset) */
static JSValue db_js_get(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)this_val;
    DbEngine *e = (DbEngine *)JS_GetContextOpaque(ctx);
    if (argc < 1) return JS_NewString(ctx, "");
    const char *id = JS_ToCString(ctx, argv[0]);
    DbNode *n = id ? db_find(e, id) : NULL;
    JSValue r = JS_NewString(ctx, n ? n->val : "");
    if (id) JS_FreeCString(ctx, id);
    return r;
}
/* native: dom.set(id, val) -> undefined */
static JSValue db_js_set(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)this_val;
    DbEngine *e = (DbEngine *)JS_GetContextOpaque(ctx);
    if (argc < 2) return JS_UNDEFINED;
    const char *id = JS_ToCString(ctx, argv[0]);
    const char *val = JS_ToCString(ctx, argv[1]);
    if (id) { DbNode *n = db_intern(e, id); if (n && val) { strncpy(n->val, val, DB_VALLEN - 1); n->val[DB_VALLEN-1]=0; } }
    if (id) JS_FreeCString(ctx, id);
    if (val) JS_FreeCString(ctx, val);
    return JS_UNDEFINED;
}

/* db_new: create engine, install the `dom` global. Returns opaque handle. */
static void *db_new(void) {
    DbEngine *e = (DbEngine *)calloc(1, sizeof(DbEngine));
    e->rt = JS_NewRuntime();
    e->ctx = JS_NewContext(e->rt);
    JS_SetContextOpaque(e->ctx, e);
    JSValue global = JS_GetGlobalObject(e->ctx);
    JSValue dom = JS_NewObject(e->ctx);
    JS_SetPropertyStr(e->ctx, dom, "get", JS_NewCFunction(e->ctx, db_js_get, "get", 1));
    JS_SetPropertyStr(e->ctx, dom, "set", JS_NewCFunction(e->ctx, db_js_set, "set", 2));
    JS_SetPropertyStr(e->ctx, global, "dom", dom);
    JS_FreeValue(e->ctx, global);
    return e;
}

/* host-side DOM writes/reads, callable from MFL */
static void db_set(void *eng, const char *id, const char *val) {
    DbEngine *e = (DbEngine *)eng;
    DbNode *n = db_intern(e, id);
    if (n) { strncpy(n->val, val, DB_VALLEN - 1); n->val[DB_VALLEN-1]=0; }
}
static const char *db_get(void *eng, const char *id) {
    DbEngine *e = (DbEngine *)eng;
    DbNode *n = db_find(e, id);
    return n ? n->val : "";
}

/* db_eval: run JS, return its result stringified. Errors come back as "ERR: ...".
 * Result is strdup'd (leaked — fine for a spike) so MFL keeps a stable pointer. */
static const char *db_eval(void *eng, const char *code) {
    DbEngine *e = (DbEngine *)eng;
    JSValue v = JS_Eval(e->ctx, code, strlen(code), "<mfl>", JS_EVAL_TYPE_GLOBAL);
    const char *out;
    if (JS_IsException(v)) {
        JSValue exc = JS_GetException(e->ctx);
        const char *m = JS_ToCString(e->ctx, exc);
        char buf[1152]; snprintf(buf, sizeof buf, "ERR: %s", m ? m : "?");
        out = strdup(buf);
        if (m) JS_FreeCString(e->ctx, m);
        JS_FreeValue(e->ctx, exc);
    } else {
        const char *s = JS_ToCString(e->ctx, v);
        out = strdup(s ? s : "");
        if (s) JS_FreeCString(e->ctx, s);
    }
    JS_FreeValue(e->ctx, v);
    return out;
}
static void db_free(void *eng) {
    DbEngine *e = (DbEngine *)eng;
    JS_FreeContext(e->ctx); JS_FreeRuntime(e->rt); free(e);
}
#endif
