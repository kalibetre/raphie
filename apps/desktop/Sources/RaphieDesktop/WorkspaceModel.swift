import AppKit
import Foundation
import RaphieClient

@MainActor final class WorkspaceModel: ObservableObject {
    @Published var server = UserDefaults.standard.string(forKey: "serverOrigin") ?? ""
    @Published var code: String?
    @Published var approvalURL: URL?
    @Published var connected = false
    @Published var busy = false
    @Published var error: String?
    @Published var bots: [Bot] = []
    @Published var botID: String?
    @Published var conversations: [Conversation] = []
    @Published var selectedID: String?
    @Published var observation: Observation?
    @Published var draft = ""
    private var drafts: [String: String] = [:]
    private var api: RaphieAPI?
    private var token: String?
    private var polling: Task<Void, Never>?
    private var approvalTask: Task<Void, Never>?
    private var approvalGeneration = UUID()
    private let store = DeviceCredentialStore()
    private var generation = UUID()
    private var pendingMessages: [String: (text: String, eventID: String)] = [:]
    private var draftKey: String { "\(botID ?? "")/\(selectedID ?? "new")" }

    func connect() {
        guard !busy else { return }
        do {
            let address = try ServerAddress(server)
            let client = RaphieAPI(address: address)
            api = client
            error = nil
            if let saved = try store.read(address) {
                token = saved
                UserDefaults.standard.set(address.origin.absoluteString, forKey: "serverOrigin")
                connected = true
                loadBots()
                return
            }
            busy = true
            let currentApproval = UUID()
            approvalGeneration = currentApproval
            approvalTask = Task {
                do {
                    let request = try await client.startAuthorization()
                    let link = try address.verificationURL(request.verification_uri_complete)
                    try Task.checkCancellation()
                    guard currentApproval == approvalGeneration else { return }
                    code = request.user_code
                    approvalURL = link
                    NSWorkspace.shared.open(link)
                    let issued = try await client.waitForAuthorization(request)
                    try Task.checkCancellation()
                    try store.save(issued, for: address)
                    token = issued
                    UserDefaults.standard.set(address.origin.absoluteString, forKey: "serverOrigin")
                    code = nil; approvalURL = nil; busy = false; connected = true
                    loadBots()
                } catch is CancellationError {
                    if currentApproval == approvalGeneration { busy = false }
                }
                catch {
                    guard currentApproval == approvalGeneration else { return }
                    busy = false; code = nil; approvalURL = nil; self.error = error.localizedDescription
                }
            }
        } catch { self.error = error.localizedDescription }
    }
    func cancelAuthorization() { approvalGeneration = UUID(); approvalTask?.cancel(); approvalTask = nil; busy = false; code = nil; approvalURL = nil }
    func forget() {
        cancelAuthorization(); polling?.cancel()
        if let api { do { try store.remove(api.address) } catch { self.error = error.localizedDescription; return } }
        generation = UUID(); connected = false; token = nil; api = nil
        bots = []; botID = nil; conversations = []; selectedID = nil; observation = nil
        drafts.removeAll(); pendingMessages.removeAll(); draft = ""
    }
    func loadBots() {
        guard let api, let token else { return }
        Task {
            do {
                let values = try await api.bots(token: token)
                guard self.token == token else { return }
                bots = values
                if botID == nil || !values.contains(where: { $0.id == botID }) { selectBot(values.first?.id) }
            } catch { handle(error) }
        }
    }
    func selectBot(_ id: String?) {
        drafts[draftKey] = draft
        generation = UUID(); polling?.cancel()
        botID = id; selectedID = nil; observation = nil; conversations = []; draft = drafts[draftKey] ?? ""
        refresh()
    }
    func selectConversation(_ id: String?) {
        drafts[draftKey] = draft
        generation = UUID(); polling?.cancel()
        selectedID = id; observation = nil; draft = drafts[draftKey] ?? ""
        refresh()
    }
    func refresh() {
        polling?.cancel()
        guard let api, let token, let botID else { return }
        let selected = selectedID, current = generation
        polling = Task {
            while !Task.isCancelled {
                do {
                    let list = try await api.conversations(bot: botID, token: token)
                    let view: Observation?
                    if let selected { view = try await api.observation(bot: botID, session: selected, token: token) } else { view = nil }
                    guard current == generation, !Task.isCancelled else { return }
                    conversations = list; observation = view
                } catch is CancellationError { return }
                catch {
                    guard current == generation else { return }
                    handle(error)
                    if !connected { return }
                }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }
    func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 4000, let api, let token, let botID else { return }
        let current = generation, session = selectedID, key = draftKey
        let pending = pendingMessages[key]
        let eventID = pending?.text == text ? pending!.eventID : UUID().uuidString.lowercased()
        pendingMessages[key] = (text, eventID)
        busy = true
        Task {
            do {
                let id = try await api.send(bot: botID, session: session, text: text, eventID: eventID, token: token)
                busy = false
                pendingMessages[key] = nil
                if drafts[key]?.trimmingCharacters(in: .whitespacesAndNewlines) == text { drafts[key] = "" }
                guard current == generation else { return }
                if draft.trimmingCharacters(in: .whitespacesAndNewlines) == text { draft = "" }
                if session == nil { selectConversation(id) } else { refresh() }
            } catch { busy = false; handle(error) }
        }
    }
    func decide(_ approval: Approval, approved: Bool) {
        guard let api, let token, let botID else { return }
        Task { do { try await api.decide(bot: botID, approval: approval.id, approved: approved, token: token); refresh() } catch { handle(error) } }
    }
    private func handle(_ error: Error) {
        if let clientError = error as? ClientError, case .unauthorized = clientError {
            polling?.cancel(); connected = false; token = nil
            if let api {
                do { try store.remove(api.address) }
                catch { self.error = error.localizedDescription; return }
            }
        }
        self.error = error.localizedDescription
    }
}
