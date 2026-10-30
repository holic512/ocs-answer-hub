"""Python 运维入口测试，不依赖 Docker 或第三方 Python 包。"""
import argparse
import ast
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hub_deploy", ROOT / "deploy" / "deploy.py")
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


class DeploymentTests(unittest.TestCase):
    def options(self, **overrides):
        values = dict(image=None, network=None, port=None, bind=None)
        values.update(overrides)
        return argparse.Namespace(**values)

    def test_python38_syntax_and_help(self):
        ast.parse((ROOT / "deploy" / "deploy.py").read_text(encoding="utf-8"), feature_version=(3, 8))
        result = subprocess.run([sys.executable, "-B", str(ROOT / "deploy" / "deploy.py"), "--help"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn("install,start,restart,update,stop,status,logs,check", result.stdout)

    def test_saved_settings_and_cli_override(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text('APP_IMAGE="local/hub:1.0.3"\nDATABASE_NETWORK=existing-net\nAPP_PORT=18888 # 服务端口\n', encoding="utf-8")
            saved = deploy.settings_for(root, self.options())
            self.assertEqual(saved["APP_IMAGE"], "local/hub:1.0.3")
            self.assertEqual(saved["APP_PORT"], "18888")
            updated = deploy.settings_for(root, self.options(image="local/hub:1.0.4", port=0))
            self.assertEqual(updated["APP_IMAGE"], "local/hub:1.0.4")
            self.assertEqual(updated["DATABASE_NETWORK"], "existing-net")
            self.assertEqual(updated["APP_PORT"], "0")

    def test_save_keeps_comments_unknown_settings_and_application_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text("# 用户注释\nAPP_IMAGE=local/hub:old\nCUSTOM=value", encoding="utf-8")
            (root / "config").mkdir()
            config = root / "config" / "config.env"
            config.write_text("private-fixture", encoding="utf-8")
            settings = deploy.settings_for(root, self.options(image="local/hub:new"))
            deploy.save_settings(root / ".env", settings)
            text = (root / ".env").read_text(encoding="utf-8")
            self.assertIn("# 用户注释\n", text)
            self.assertIn("CUSTOM=value\n", text)
            self.assertIn("APP_IMAGE=local/hub:new\n", text)
            self.assertEqual(config.read_text(encoding="utf-8"), "private-fixture")
            self.assertEqual((root / ".env").stat().st_mode & 0o777, 0o600)

    def test_invalid_parameters_and_missing_installation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for values in (dict(port=-1), dict(port=65536), dict(image="bad image"), dict(network="bad/network"), dict(bind="not-an-ip")):
                with self.assertRaises(RuntimeError):
                    deploy.settings_for(root, self.options(**values))
            result = subprocess.run([sys.executable, "-B", str(ROOT / "deploy" / "deploy.py"), "stop", "--dir", str(root)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn("尚未安装", result.stderr)
            self.assertFalse((root / "config").exists())


if __name__ == "__main__":
    unittest.main()
