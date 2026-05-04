#!/bin/bash
git remote remove origin 2>/dev/null
git remote add origin https://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@github.com/jeffsvendsonjr-jpg/backcheck.git
git push -u origin main
echo "Done! Now delete this script: rm push.sh"
echo "And delete the token at https://github.com/settings/tokens"
