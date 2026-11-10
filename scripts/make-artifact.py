# Turns dist-demo/index.html (one self-contained file) into page content for a hosted preview:
# keeps the title, the inlined CSS and JS, drops the manifest/icon links.
import re, sys
src = open('dist-demo/index.html', encoding='utf-8').read()
title = re.search(r'<title>(.*?)</title>', src, re.S).group(1)
s0 = src.index('<script'); s1 = src.index('>', s0) + 1; s2 = src.index('</script>', s1)
js = src[s1:s2]
c0 = src.index('<style'); c1 = src.index('>', c0) + 1; c2 = src.index('</style>', c1)
css = src[c1:c2]
out = f'<title>{title}</title>\n<style>{css}</style>\n<div id="root"></div>\n<script type="module">{js}</script>\n'
open(sys.argv[1], 'w', encoding='utf-8').write(out)
print('written', len(out))
