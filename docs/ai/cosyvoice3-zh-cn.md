# CosyVoice3 本地 provider 使用说明

此接入使用普通版 `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`，权重文件为 `llm.pt`。
它通过官方 FastAPI 协议连接本地 CosyVoice Python 服务。AIRI 不会自动下载模型或启动 Python 服务。

## 准备本地服务

本机部署目录为 `G:\project\cosyvoice3`，使用独立 Python 3.10 环境和 CUDA PyTorch。
模型位于 `pretrained_models\Fun-CosyVoice3-0.5B-2512`，加载普通版 `llm.pt`。
项目来源为 [CosyVoice 官方项目](https://github.com/QwenAudio/CosyVoice)。

在 PowerShell 中启动服务：

```powershell
& G:\project\cosyvoice3\start-airi.ps1
```

也可以双击 `G:\project\cosyvoice3\start-airi.cmd`。
服务默认监听 `http://127.0.0.1:50000/`，关闭启动窗口或按 `Ctrl+C` 停止。
启动脚本启用 Hugging Face 离线模式，读取本机已经下载的模型。

检查模型服务：

```powershell
Invoke-RestMethod http://127.0.0.1:50000/health
```

返回内容包含 `ready: true`、`checkpoint: llm.pt` 和 `sample_rate: 24000`。
运行真实合成测试：

```powershell
Set-Location G:\project\cosyvoice3
.venv\Scripts\python.exe local\check-api.py
```

测试生成的 WAV 文件保存在 `G:\project\cosyvoice3\outputs`。
本地服务代码为 `local\airi-api.py`，采用官方推理方法，并保留相同的 multipart 请求格式。
该服务将上传音频写入临时 WAV，解决当前官方示例服务传入 Tensor 与前端重新读取文件之间的不匹配。
GPU 请求按顺序执行，完成后删除临时音频。

打开 `http://127.0.0.1:50000/docs`，确认能看到以下端点：

- `/inference_zero_shot`
- `/inference_cross_lingual`
- `/inference_instruct2`

服务实际加载的模型由服务端配置决定。AIRI 的模型选项不会切换服务端权重。
不要用 `llm.rl.pt` 替换 `llm.pt`。

## 在 AIRI 中配置

1. 打开“设置 → Providers → Speech → CosyVoice3（本地）”。
2. 在 Advanced 中填写服务根地址，默认 `http://127.0.0.1:50000/`。
3. 上传清晰的 WAV 参考音频。音频时长少于 30 秒，大小不超过 2 MiB。
4. 选择合成模式并填写对应字段。
5. 在试听区域选择上传的参考音色，然后点击测试。
6. 打开“Modules → Speech”，选择 CosyVoice3、普通版模型和参考音色。
7. 如果角色卡覆盖了 Speech 模块，也要在角色卡中选择此 provider、模型和音色。

此 provider 不需要 API Key。参考音频以数据形式随 provider 配置保存，可供聊天、试听及其他窗口使用。
它不是服务端文件路径，也不是临时浏览器 Blob URL。

## 三种合成模式

| 模式 | 所需内容 | 用途 |
| --- | --- | --- |
| 参考音频与原文克隆 | 参考 WAV、音频中的准确原文 | 用参考声音朗读新文本 |
| 跨语言音色克隆 | 参考 WAV | 参考声音与朗读文本语言不同，无需填写参考原文 |
| 音色克隆与表达指令 | 参考 WAV、表达指令 | 控制发音语言、情绪和表达方式 |

例如，表达指令可填写“请用愉快的语气说日语”。指令应用于每次合成请求。
请直接填写自然语言内容。AIRI 自动添加 CosyVoice3 所需的控制标记。
中日混合文本和共享汉字的发音仍需实际试听验证。

## 分句合成

聊天和“测试声音”都按完整句子分别请求 CosyVoice3，不再把多句中日文本放入同一次推理。
例如 `你好。こんにちは。よろしくお願いします。` 会发起三次请求。
日语句子中的汉字、假名和逗号保留在同一段，不按单个字或词切分。
聊天收到完整句子后立即交付合成，不再等待整条回复结束，也不额外调用 Chat 模型。
文字生成继续进行，已完成的语音按原文顺序播放。上一句播放时，下一句可以继续合成。
未闭合的 Markdown 等待补全后再交付，代码块和 HTML 不朗读。
没有句号的最后一段在回复结束时交付。取消或打断会停止后续语音的提交和播放。
试听会等待所有句子合成完成，再将 PCM 按顺序拼接为一个 WAV。
每句继续使用配置的参考音色、合成模式和表达指令。取消请求会停止后续句子的提交。

本地服务在内存中缓存参考音色特征，最多保留四组。
音频、模式或参考原文与指令发生变化时，会使用独立的缓存项。
启动脚本会预热 `unicorn.wav` 的跨语言音色特征，减少首句的重复音频处理。
`/health` 的 `reference_cache` 显示缓存数量、命中次数和提取次数。
语音合成一次执行一个 GPU 任务，播放与下一句合成可以重叠。

分句不等于语言识别。同一句里的语言切换和纯汉字日语仍存在歧义。
已知全文为日语时，可使用表达指令模式，填写“请用日语朗读”。

## 当前范围与排查

- 聊天与试听共用请求适配器，不额外调用 Chat 模型标注语言或情绪。
- 官方示例服务返回 24 kHz 单声道 PCM16。AIRI 收集每次响应，并封装为一个 WAV 后播放。
- 此版本按句请求完整音频，尚未实现模型的增量文本输入和音频块连续播放。
- 此 provider 不支持 SSML，也不提供精确语速倍率和分段停顿设置。
- 连接验证读取 `/openapi.json`，不会发起语音合成，也无法检测实际加载的权重是否为 RL 版。
- 出现 HTTP 错误时，检查 Python 服务日志、模型目录及依赖。错误会传回 AIRI 试听区域。
- WAV 参考音频会发送到配置的 CosyVoice 服务地址。
- 本机的主模型使用 GPU，ONNX 音频特征提取使用 CPU。
- WeText 从 `G:\project\cosyvoice3\pretrained_models\WeText` 加载固定的中英文规则，启动不再请求 ModelScope。
- `/health` 显示 `text_normalizer: wetext`、`normalizer_resources: local`。规则缺失或损坏会阻止服务启动。
- 朗读文本在进入推理前完成规范化，控制前缀仍会保留。含假名的日文和日语表达指令跳过中英文规则。

协议依据：[官方 FastAPI 服务源码](https://github.com/QwenAudio/CosyVoice/blob/main/runtime/python/fastapi/server.py)。
