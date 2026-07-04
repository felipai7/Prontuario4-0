#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
 EXPORTADOR AUTOMÁTICO do relatório XML em lote — portal do laboratório
 (My Pardini / Grupo Fleury). Automatiza o download que hoje é feito à mão.
--------------------------------------------------------------------------------
 O QUE FAZ
   • Faz login no portal (pausa para 2FA, se houver).
   • Abre a tela de "exportação de resultados em lote".
   • Para um período (ex.: 7 dias), preenche as datas, dispara a exportação e
     baixa o arquivo XML, já renomeando no padrão hpres_<codlab>_<ddmmaaaa>.xml.
   • Modo RETROATIVO: percorre automaticamente janelas de 7 dias cobrindo os
     últimos N meses (default 18), baixando um XML por semana.
   • Retoma de onde parou (checkpoint) e não rebaixa período já existente.
   • Opcional: já gera os relatórios PDF/Excel de cada semana (--gerar).

 IMPORTANTE
   • Sem API pública: a única via é a interface web. Este script é um MOTOR
     comentado; os pontos  # >>> CONFIGURAR  dependem da tela real do portal e
     só podem ser preenchidos por você, com acesso autorizado. Não foi possível
     testá-lo aqui porque exige o portal logado.
   • Conformidade: confirme os termos de uso do portal e a LGPD. Se houver 2FA,
     o script PAUSA e pede o login humano — nunca tente contornar o 2º fator.

 INSTALAÇÃO
   pip install selenium webdriver-manager
   (Chrome instalado; o webdriver-manager baixa o driver compatível.)

 EXEMPLOS
   # uma semana específica
   python exportar_xml_pardini.py --de 2026-01-01 --ate 2026-01-07
   # retroativo: últimos 18 meses em janelas de 7 dias, e já gera os relatórios
   python exportar_xml_pardini.py --retroativo-meses 18 --gerar
================================================================================
"""
import os, sys, csv, json, time, argparse, subprocess, datetime as dt

try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import TimeoutException, WebDriverException
except ImportError:
    print("Instale: pip install selenium webdriver-manager"); raise

# ==============================================================================
# CONFIGURAÇÃO — ajuste aqui (centralizado para manutenção)
# ==============================================================================
CFG = {
    "pasta_saida":  r"D:\CulturasUTI\Exports",     # >>> CONFIGURAR onde salvar os XML
    "url_login":    "https://resultados.grupofleury.com.br/",  # >>> CONFIRMAR
    "codlab":       "1388",
    "timeout":      40,
    "tentativas":   3,
    "backoff":      [5, 15, 30],
    "dias_janela":  7,              # tamanho de cada lote (o padrão do laboratório)
    "usuario_env":  "LAB_USER",     # credenciais via variáveis de ambiente (não no código)
    "senha_env":    "LAB_PASS",
    "gerador":      "gerar_relatorio_semanal.py",  # usado com --gerar
}

# >>> CONFIGURAR: seletores reais da tela de exportação (inspecione o portal).
SEL = {
    "campo_usuario": (By.ID, "CONFIGURAR_usuario"),
    "campo_senha":   (By.ID, "CONFIGURAR_senha"),
    "btn_entrar":    (By.XPATH, "//button[contains(.,'Entrar')]"),
    "flag_logado":   (By.XPATH, "CONFIGURAR_elemento_pos_login"),   # confirma que logou
    "menu_export":   (By.XPATH, "//a[contains(.,'Exportar') or contains(.,'Resultados em lote')]"),
    "campo_data_ini":(By.ID, "CONFIGURAR_data_inicial"),
    "campo_data_fim":(By.ID, "CONFIGURAR_data_final"),
    "seletor_formato_xml": (By.XPATH, "CONFIGURAR_opcao_XML"),      # se houver escolha de formato
    "btn_exportar":  (By.XPATH, "//button[contains(.,'Exportar') or contains(.,'Gerar')]"),
    "flag_login":    (By.ID, "CONFIGURAR_usuario"),                 # se visível => sessão caiu
}
FORMATO_DATA_PORTAL = "%d/%m/%Y"   # >>> CONFIRMAR como o portal espera a data

# ==============================================================================
# util
# ==============================================================================
def log(msg): print(f"{dt.datetime.now():%H:%M:%S} | {msg}", flush=True)

def esperar(driver, sel, t=None):
    return WebDriverWait(driver, t or CFG["timeout"]).until(EC.presence_of_element_located(sel))
def clicavel(driver, sel, t=None):
    return WebDriverWait(driver, t or CFG["timeout"]).until(EC.element_to_be_clickable(sel))

def com_retry(func, desc):
    ult=None
    for i in range(CFG["tentativas"]):
        try: return func()
        except (TimeoutException, WebDriverException) as e:
            ult=e; esp=CFG["backoff"][min(i,len(CFG["backoff"])-1)]
            log(f"falha '{desc}' ({i+1}/{CFG['tentativas']}): {type(e).__name__}; aguardando {esp}s")
            time.sleep(esp)
    raise ult

def caminho_checkpoint():
    return os.path.join(CFG["pasta_saida"], "_export_checkpoint.json")
def carregar_ck():
    p=caminho_checkpoint()
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {"feitos": []}
def salvar_ck(ck):
    ck["atualizado_em"]=dt.datetime.now().isoformat(timespec="seconds")
    json.dump(ck, open(caminho_checkpoint(),"w",encoding="utf-8"), ensure_ascii=False, indent=2)
def log_erro(ini, fim, etapa, msg):
    p=os.path.join(CFG["pasta_saida"], "_export_erros.csv")
    novo=not os.path.exists(p)
    with open(p,"a",newline="",encoding="utf-8-sig") as f:
        w=csv.writer(f,delimiter=";")
        if novo: w.writerow(["timestamp","de","ate","etapa","erro"])
        w.writerow([dt.datetime.now().isoformat(), ini, fim, etapa, msg[:200]])

def nome_esperado(fim_iso):
    d=dt.date.fromisoformat(fim_iso)
    return f'hpres_{CFG["codlab"]}_{d:%d_%m_%Y} 23_59_59.xml'

# ==============================================================================
# janelas de 7 dias (retroativo)
# ==============================================================================
def janelas(de_iso, ate_iso, dias):
    de=dt.date.fromisoformat(de_iso); ate=dt.date.fromisoformat(ate_iso)
    cur=de
    while cur <= ate:
        fim=min(cur + dt.timedelta(days=dias-1), ate)
        yield cur.isoformat(), fim.isoformat()
        cur = fim + dt.timedelta(days=1)

def retroativo_por_meses(meses, dias):
    hoje=dt.date.today()
    inicio=hoje - dt.timedelta(days=int(meses*30.44))
    return list(janelas(inicio.isoformat(), hoje.isoformat(), dias))

def _proximo_mes(d):
    return dt.date(d.year + (1 if d.month==12 else 0), 1 if d.month==12 else d.month+1, 1)

def janelas_mensais(de_iso, ate_iso):
    """Janelas por mês-calendário: (1º dia do mês, último dia do mês)."""
    de=dt.date.fromisoformat(de_iso); ate=dt.date.fromisoformat(ate_iso)
    cur=dt.date(de.year, de.month, 1)
    while cur <= ate:
        prox=_proximo_mes(cur)
        yield max(cur, de).isoformat(), min(prox - dt.timedelta(days=1), ate).isoformat()
        cur=prox

def janela_de_um_mes(ano_mes):
    """'2026-01' -> ('2026-01-01','2026-01-31')."""
    ano, mes = [int(x) for x in ano_mes.split("-")[:2]]
    ini=dt.date(ano, mes, 1)
    fim=_proximo_mes(ini) - dt.timedelta(days=1)
    return ini.isoformat(), fim.isoformat()

def retroativo_mensal(meses):
    """Últimos N meses, uma janela por mês-calendário."""
    hoje=dt.date.today()
    inicio=(hoje.replace(day=1))
    for _ in range(int(meses)-1):
        inicio=_proximo_mes(inicio.replace(day=1)) if False else dt.date(
            inicio.year - (1 if inicio.month==1 else 0),
            12 if inicio.month==1 else inicio.month-1, 1)
    return list(janelas_mensais(inicio.isoformat(), hoje.isoformat()))

# ==============================================================================
# navegador / login
# ==============================================================================
def abrir(pasta):
    os.makedirs(pasta, exist_ok=True)
    o=webdriver.ChromeOptions()
    o.add_experimental_option("prefs", {
        "download.default_directory": pasta,
        "download.prompt_for_download": False,
        "plugins.always_open_pdf_externally": True,
    })
    # o.add_argument("--headless=new")  # deixe VISÍVEL na 1ª vez p/ tratar 2FA
    d=webdriver.Chrome(options=o)
    d.set_page_load_timeout(CFG["timeout"]*2)
    return d

def login(driver):
    driver.get(CFG["url_login"])
    try:
        esperar(driver, SEL["campo_usuario"], 15)
        driver.find_element(*SEL["campo_usuario"]).send_keys(os.environ.get(CFG["usuario_env"],""))
        driver.find_element(*SEL["campo_senha"]).send_keys(os.environ.get(CFG["senha_env"],""))
        clicavel(driver, SEL["btn_entrar"]).click()
    except TimeoutException:
        log("tela de login não detectada — talvez já autenticado.")
    # 2FA / confirmação humana (não automatizar o 2º fator):
    if os.environ.get("EXPORT_INTERATIVO","1")=="1":
        try:
            WebDriverWait(driver,8).until(EC.presence_of_element_located(SEL["flag_logado"]))
        except TimeoutException:
            input(">> Conclua o login/2FA no navegador e tecle ENTER para continuar... ")
    log("login ok (ou já autenticado).")

def sessao_caiu(driver):
    try: driver.find_element(*SEL["flag_login"]); return True
    except WebDriverException: return False

# ==============================================================================
# exportar UMA janela
# ==============================================================================
def aguardar_download(pasta, antes, timeout):
    fim=time.time()+timeout
    while time.time()<fim:
        novos=set(os.listdir(pasta))-antes
        prontos=[n for n in novos if n.lower().endswith(".xml")
                 and not n.endswith(".crdownload") and not n.endswith(".part")]
        if prontos: return prontos[0]
        time.sleep(1)
    return None

def exportar_janela(driver, ini, fim):
    """Preenche datas, dispara exportação e baixa o XML. Renomeia no padrão."""
    destino_final=os.path.join(CFG["pasta_saida"], nome_esperado(fim))
    if os.path.exists(destino_final):
        log(f"[pulado] {ini}..{fim} já existe"); return destino_final

    def _passos():
        # 1) ir à tela de exportação
        clicavel(driver, SEL["menu_export"]).click()
        # 2) preencher período (>>> CONFIGURAR formato/máscara do portal)
        di=esperar(driver, SEL["campo_data_ini"]); di.clear()
        di.send_keys(dt.date.fromisoformat(ini).strftime(FORMATO_DATA_PORTAL))
        df=driver.find_element(*SEL["campo_data_fim"]); df.clear()
        df.send_keys(dt.date.fromisoformat(fim).strftime(FORMATO_DATA_PORTAL))
        # 3) escolher formato XML se houver opção
        try: driver.find_element(*SEL["seletor_formato_xml"]).click()
        except WebDriverException: pass
        # 4) disparar
        antes=set(os.listdir(CFG["pasta_saida"]))
        clicavel(driver, SEL["btn_exportar"]).click()
        baixado=aguardar_download(CFG["pasta_saida"], antes, CFG["timeout"]*2)
        if not baixado:
            raise TimeoutException("download do XML não concluído")
        os.replace(os.path.join(CFG["pasta_saida"], baixado), destino_final)
        return destino_final

    return com_retry(_passos, f"exportar {ini}..{fim}")

# ==============================================================================
# main
# ==============================================================================
def gerar_relatorio(xml_path):
    base=os.path.dirname(os.path.abspath(__file__))
    script=os.path.join(base, CFG["gerador"])
    if not os.path.exists(script):
        log("gerador não encontrado ao lado do exportador; pulei a geração."); return
    subprocess.run([sys.executable, script, "--xml", xml_path,
                    "--saida", os.path.join(os.path.dirname(xml_path),"..","Relatorios")],
                   check=False)

def main():
    ap=argparse.ArgumentParser(description="Exporta o XML em lote do portal (semanal ou retroativo).")
    ap.add_argument("--de", help="data inicial AAAA-MM-DD (janela única)")
    ap.add_argument("--ate", help="data final AAAA-MM-DD (janela única)")
    ap.add_argument("--mes", help="exporta UM mês específico, ex.: --mes 2026-01")
    ap.add_argument("--retroativo-meses", type=float, help="baixa N meses para trás")
    ap.add_argument("--mensal", action="store_true",
                    help="usa janelas por MÊS (um XML por mês) em vez de 7 dias")
    ap.add_argument("--dias", type=int, default=CFG["dias_janela"], help="tamanho da janela em dias (default 7)")
    ap.add_argument("--saida", help="pasta de saída dos XML (sobrepõe a config)")
    ap.add_argument("--gerar", action="store_true", help="gera PDF/Excel de cada período baixado")
    a=ap.parse_args()
    if a.saida: CFG["pasta_saida"]=a.saida
    os.makedirs(CFG["pasta_saida"], exist_ok=True)

    if a.mes:
        di, df = janela_de_um_mes(a.mes)
        alvos=[(di, df)]
    elif a.retroativo_meses:
        alvos = retroativo_mensal(a.retroativo_meses) if a.mensal \
                else retroativo_por_meses(a.retroativo_meses, a.dias)
    elif a.de and a.ate:
        alvos = list(janelas_mensais(a.de, a.ate)) if a.mensal \
                else list(janelas(a.de, a.ate, a.dias))
    else:
        print("Informe --mes AAAA-MM, ou --de/--ate, ou --retroativo-meses N"); sys.exit(1)

    ck=carregar_ck(); feitos=set(ck["feitos"])
    log(f"janelas a processar: {len(alvos)} | pasta: {CFG['pasta_saida']}")
    driver=abrir(CFG["pasta_saida"])
    ok=falhas=0
    try:
        login(driver)
        for ini, fim in alvos:
            chave=f"{ini}..{fim}"
            if chave in feitos or os.path.exists(os.path.join(CFG["pasta_saida"], nome_esperado(fim))):
                log(f"[ok-existente] {chave}"); continue
            try:
                xml=exportar_janela(driver, ini, fim)
                feitos.add(chave); ck["feitos"]=list(feitos); salvar_ck(ck)
                ok+=1; log(f"[baixado] {chave} -> {os.path.basename(xml)}")
                if a.gerar: gerar_relatorio(xml)
            except Exception as e:
                falhas+=1; log_erro(ini, fim, "exportar", str(e))
                log(f"[ERRO] {chave}: {type(e).__name__}")
                if sessao_caiu(driver):
                    log("sessão caiu — refazendo login.");
                    try: login(driver)
                    except Exception: pass
    finally:
        driver.quit()
    log(f"FIM. Baixados: {ok} | Falhas: {falhas} | Total alvo: {len(alvos)}")
    log(f"Erros detalhados (se houver): {os.path.join(CFG['pasta_saida'],'_export_erros.csv')}")

if __name__ == "__main__":
    main()
