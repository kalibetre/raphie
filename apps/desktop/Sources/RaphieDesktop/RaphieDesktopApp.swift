import AppKit
import RaphieClient
import SwiftUI

@main struct RaphieDesktopApp: App {
    @StateObject private var model = WorkspaceModel()
    var body: some Scene {
        WindowGroup("Raphie") {
            Group { if model.connected { WorkspaceView(model: model) } else { ConnectView(model: model) } }
                .frame(minWidth: 740, minHeight: 520)
        }
        .windowStyle(.titleBar)
    }
}

private struct ConnectView: View {
    @ObservedObject var model: WorkspaceModel
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Image(systemName: "bubble.left.and.bubble.right.fill").font(.system(size: 30)).foregroundStyle(.tint)
            Text("Connect to Raphie").font(.largeTitle.weight(.semibold))
            Text("Enter the HTTPS address of your Raphie server. You’ll approve this Mac in your browser.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            TextField("https://your-server.tailnet.ts.net", text: $model.server)
                .textFieldStyle(.roundedBorder).disabled(model.busy).accessibilityLabel("Raphie server address")
            if let code = model.code {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Compare this code in your browser").font(.headline)
                    Text(code).font(.system(.title, design: .monospaced).weight(.semibold)).textSelection(.enabled)
                    if let url = model.approvalURL { Link("Open approval page", destination: url) }
                    Text("Waiting for approval…").foregroundStyle(.secondary)
                }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
            }
            if let error = model.error { Text(error).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                if model.busy { Button("Cancel") { model.cancelAuthorization() } }
                else { Button("Connect") { model.connect() }.keyboardShortcut(.defaultAction).disabled(model.server.isEmpty) }
                Spacer()
            }
        }.padding(32).frame(maxWidth: 520, alignment: .leading).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct WorkspaceView: View {
    @ObservedObject var model: WorkspaceModel
    var body: some View {
        NavigationSplitView {
            List(selection: Binding(get: { model.botID }, set: { model.selectBot($0) })) {
                Section("Bots") { ForEach(model.bots) { bot in Text(bot.name).tag(bot.id) } }
            }.navigationSplitViewColumnWidth(min: 150, ideal: 190)
                .toolbar { Button("Disconnect from this Mac") { model.forget() }.help("Remove the token from this Mac") }
        } content: {
            VStack(spacing: 0) {
                HStack { Text("Conversations").font(.headline); Spacer(); Button { model.selectConversation(nil) } label: { Image(systemName: "square.and.pencil") }.help("New conversation") }.padding()
                List(selection: Binding(get: { model.selectedID }, set: { model.selectConversation($0) })) {
                    ForEach(model.conversations) { conversation in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(conversation.title).lineLimit(1)
                            Text(conversation.preview).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }.tag(conversation.id)
                    }
                }
            }.navigationSplitViewColumnWidth(min: 210, ideal: 250)
        } detail: {
            VStack(spacing: 0) {
                HStack { Text(model.conversations.first(where: { $0.id == model.selectedID })?.title ?? "New conversation").font(.headline); Spacer(); if let phase = model.observation?.phase, phase != "idle" { Text(phase.capitalized).foregroundStyle(.secondary) } }.padding()
                Divider()
                ScrollViewReader { reader in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 18) {
                            ForEach(model.observation?.turns ?? []) { turn in
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("You").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                    Text(turn.text).textSelection(.enabled)
                                    if let answer = turn.answer { Text("Raphie").font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 4); Text(answer).textSelection(.enabled) }
                                    else if turn.status == "pending" { ProgressView().controlSize(.small) }
                                }.frame(maxWidth: .infinity, alignment: .leading).id(turn.id)
                            }
                            ForEach((model.observation?.toolApprovals ?? []).filter { $0.status == "pending" }) { approval in
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Approval requested").font(.headline)
                                    Text("\(approval.server) · \(approval.tool)").font(.subheadline)
                                    Text(approval.argumentsJson).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                                    HStack { Button("Deny") { model.decide(approval, approved: false) }; Button("Approve") { model.decide(approval, approved: true) } }
                                }.padding().frame(maxWidth: .infinity, alignment: .leading).background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
                            }
                        }.padding(24)
                    }.onChange(of: model.observation?.turns.count) { _ in if let id = model.observation?.turns.last?.id { reader.scrollTo(id, anchor: .bottom) } }
                }
                if let error = model.error { Text(error).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal) }
                HStack(alignment: .bottom) {
                    TextField("Message Raphie", text: $model.draft, axis: .vertical).lineLimit(1...6).textFieldStyle(.roundedBorder).disabled(model.botID == nil)
                    Button("Send") { model.send() }.keyboardShortcut(.return, modifiers: [.command]).disabled(model.busy || model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.botID == nil)
                }.padding()
            }
        }
    }
}
