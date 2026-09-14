import UIKit

private final class PaddedLabel: UILabel {
  var inset = UIEdgeInsets(top: 11, left: 12, bottom: 11, right: 12)
  override func drawText(in rect: CGRect) { super.drawText(in: rect.inset(by: inset)) }
  override var intrinsicContentSize: CGSize {
    let value = super.intrinsicContentSize
    return CGSize(width: value.width + inset.left + inset.right, height: value.height + inset.top + inset.bottom)
  }
}

final class ShareViewController: UIViewController, UITextViewDelegate {
  private let ink = UIColor.label
  private let paper = UIColor { $0.userInterfaceStyle == .dark ? .systemBackground : UIColor(red: 0.953, green: 0.953, blue: 0.941, alpha: 1) }
  private let muted = UIColor.secondaryLabel
  private let accent = UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 1, green: 0.48, blue: 0.35, alpha: 1) : UIColor(red: 0.776, green: 0.231, blue: 0.137, alpha: 1) }
  private let titleLabel = UILabel()
  private let statusLabel = UILabel()
  private let organizationLabel = UILabel()
  private let itemStack = UIStackView()
  private let noteView = UITextView()
  private let notePlaceholder = UILabel()
  private let saveButton = UIButton(type: .system)
  private let cancelButton = UIButton(type: .system)
  private let openButton = UIButton(type: .system)
  private let folderButton = UIButton(type: .system)
  private let tagsButton = UIButton(type: .system)
  private var organization = FoundkeepOrganization.starters
  private var selectedFolder: FoundkeepFolder?
  private var selectedTags: [String] = []
  private var isCreatingFolder = false
  private var isSaving = false
  private var requiresFolderReview = false
  private var folderMutationGeneration = 0
  private var items: [FoundkeepShareItem] = []
  private var loader: ShareItemLoader?
  private var uploader: ShareUploader?

  override func viewDidLoad() {
    super.viewDidLoad()
    buildInterface()
    Task { await loadItems() }
  }

  private func buildInterface() {
    preferredContentSize = CGSize(width: 0, height: 720)
    view.backgroundColor = paper
    configureTextButton(cancelButton, title: "Cancel", action: #selector(cancelShare))
    configureTextButton(saveButton, title: "Save", action: #selector(saveShare))
    saveButton.tintColor = accent
    saveButton.isEnabled = false
    let navigation = UIStackView(arrangedSubviews: [cancelButton, UIView(), saveButton])
    navigation.axis = .horizontal
    navigation.alignment = .center
    navigation.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(navigation)

    let mark = UIImageView(image: UIImage(named: "FoundkeepMark"))
    mark.contentMode = .scaleAspectFit
    mark.isAccessibilityElement = false
    mark.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([mark.widthAnchor.constraint(equalToConstant: 40), mark.heightAnchor.constraint(equalToConstant: 40)])
    let appName = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "FoundKeep"
    titleLabel.text = "Save to \(appName)"
    titleLabel.font = .preferredFont(forTextStyle: .title2)
    titleLabel.adjustsFontForContentSizeCategory = true
    titleLabel.textColor = ink
    titleLabel.numberOfLines = 0
    let brand = UIStackView(arrangedSubviews: [mark, titleLabel])
    brand.axis = .horizontal
    brand.spacing = 12
    brand.alignment = .center
    configureLabel(statusLabel, text: "Reading what you shared…")
    configureLabel(organizationLabel, text: "Choose a folder and tags for this save.")
    itemStack.axis = .vertical
    itemStack.spacing = 8

    noteView.backgroundColor = .secondarySystemGroupedBackground
    noteView.layer.cornerRadius = 10
    noteView.font = .preferredFont(forTextStyle: .body)
    noteView.adjustsFontForContentSizeCategory = true
    noteView.textColor = ink
    noteView.delegate = self
    noteView.accessibilityLabel = "Note"
    noteView.translatesAutoresizingMaskIntoConstraints = false
    noteView.heightAnchor.constraint(equalToConstant: 108).isActive = true
    noteView.textContainerInset = UIEdgeInsets(top: 12, left: 9, bottom: 12, right: 9)
    notePlaceholder.text = "Add a note…"
    notePlaceholder.font = .preferredFont(forTextStyle: .body)
    notePlaceholder.adjustsFontForContentSizeCategory = true
    notePlaceholder.textColor = .placeholderText
    notePlaceholder.isAccessibilityElement = false
    notePlaceholder.translatesAutoresizingMaskIntoConstraints = false
    noteView.addSubview(notePlaceholder)
    NSLayoutConstraint.activate([
      notePlaceholder.leadingAnchor.constraint(equalTo: noteView.frameLayoutGuide.leadingAnchor, constant: 14),
      notePlaceholder.topAnchor.constraint(equalTo: noteView.frameLayoutGuide.topAnchor, constant: 12),
      notePlaceholder.trailingAnchor.constraint(lessThanOrEqualTo: noteView.frameLayoutGuide.trailingAnchor, constant: -12),
    ])

    for button in [folderButton, tagsButton] {
      button.showsMenuAsPrimaryAction = true
      button.contentHorizontalAlignment = .leading
      button.titleLabel?.adjustsFontForContentSizeCategory = true
      button.heightAnchor.constraint(greaterThanOrEqualToConstant: 56).isActive = true
    }
    updateOrganizationButtons()
    configureTextButton(openButton, title: "Open FoundKeep to connect", action: #selector(openFoundkeep))
    openButton.isHidden = true
    openButton.tintColor = accent
    let stack = UIStackView(arrangedSubviews: [brand, statusLabel, itemStack, noteView, folderButton, tagsButton, organizationLabel, openButton])
    stack.axis = .vertical
    stack.spacing = 16
    stack.translatesAutoresizingMaskIntoConstraints = false
    let scroll = UIScrollView()
    scroll.alwaysBounceVertical = true
    scroll.keyboardDismissMode = .interactive
    scroll.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scroll)
    scroll.addSubview(stack)
    NSLayoutConstraint.activate([
      navigation.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
      navigation.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
      navigation.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
      scroll.topAnchor.constraint(equalTo: navigation.bottomAnchor, constant: 12),
      scroll.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
      stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
      stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
      stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -20),
      stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40),
    ])
  }

  private func configureTextButton(_ button: UIButton, title: String, action: Selector) {
    button.setTitle(title, for: .normal)
    button.tintColor = ink
    button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
    button.titleLabel?.adjustsFontForContentSizeCategory = true
    button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    button.addTarget(self, action: action, for: .touchUpInside)
  }

  private func configureLabel(_ label: UILabel, text: String) {
    label.text = text
    label.font = .preferredFont(forTextStyle: .footnote)
    label.adjustsFontForContentSizeCategory = true
    label.textColor = muted
    label.numberOfLines = 0
  }

  private func updateOrganizationButtons() {
    configureOrganizationButton(folderButton, title: "Folder", value: selectedFolder?.name ?? "No folder", symbol: "folder")
    configureOrganizationButton(tagsButton, title: "Tags", value: selectedTags.isEmpty ? "Add tags" : selectedTags.joined(separator: ", "), symbol: "tag")
    let noFolder = UIAction(title: "No folder", image: UIImage(systemName: "tray"), state: selectedFolder == nil ? .on : .off) { [weak self] _ in
      self?.selectedFolder = nil
      self?.requiresFolderReview = false
      self?.organizationLabel.text = "Folder and tags apply to every item in this save."
      self?.updateOrganizationButtons()
    }
    let folders = organization.folders.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }.map { folder in
      UIAction(title: folder.name, state: selectedFolder?.id == folder.id ? .on : .off) { [weak self] _ in
        self?.selectedFolder = folder
        self?.requiresFolderReview = false
        self?.organizationLabel.text = "Folder and tags apply to every item in this save."
        self?.updateOrganizationButtons()
      }
    }
    let suggestedFolders = organization.suggestedFolders.filter { name in
      !organization.folders.contains { $0.name.caseInsensitiveCompare(name) == .orderedSame }
    }.map { name in
      UIAction(title: name, image: UIImage(systemName: "folder.badge.plus")) { [weak self] _ in self?.createFolder(name: name) }
    }
    let customFolder = UIAction(title: "New folder…", image: UIImage(systemName: "plus")) { [weak self] _ in self?.presentFolderPrompt() }
    var folderSections: [UIMenuElement] = [UIMenu(options: .displayInline, children: [noFolder] + folders)]
    if !suggestedFolders.isEmpty { folderSections.append(UIMenu(title: "Create a starter folder", options: .displayInline, children: suggestedFolders)) }
    folderSections.append(UIMenu(options: .displayInline, children: [customFolder]))
    folderButton.menu = UIMenu(title: "Save in a folder", children: folderSections)

    var seen = Set<String>()
    let names = (selectedTags + organization.tags.map(\.name) + organization.suggestedTags).filter { seen.insert($0.lowercased()).inserted }
    let tags = names.map { name in
      let selected = selectedTags.contains { $0.caseInsensitiveCompare(name) == .orderedSame }
      let action = UIAction(title: name, state: selected ? .on : .off) { [weak self] _ in self?.toggleTag(name) }
      if !selected && selectedTags.count >= 20 { action.attributes.insert(.disabled) }
      return action
    }
    let customTag = UIAction(title: "New tag…", image: UIImage(systemName: "plus")) { [weak self] _ in self?.presentTagPrompt() }
    if selectedTags.count >= 20 { customTag.attributes.insert(.disabled) }
    var tagSections: [UIMenuElement] = [UIMenu(options: .displayInline, children: tags), UIMenu(options: .displayInline, children: [customTag])]
    if !selectedTags.isEmpty {
      let clear = UIAction(title: "Clear tags", image: UIImage(systemName: "xmark")) { [weak self] _ in self?.selectedTags = []; self?.updateOrganizationButtons() }
      tagSections.append(UIMenu(options: .displayInline, children: [clear]))
    }
    tagsButton.menu = UIMenu(title: "Choose tags · \(selectedTags.count)/20", children: tagSections)
    folderButton.isEnabled = uploader?.isConnected == true && !isSaving && !isCreatingFolder
    tagsButton.isEnabled = !isSaving && !isCreatingFolder
    saveButton.isEnabled = !items.isEmpty && uploader?.isConnected == true && !isSaving && !isCreatingFolder && !requiresFolderReview
  }

  private func configureOrganizationButton(_ button: UIButton, title: String, value: String, symbol: String) {
    var configuration = UIButton.Configuration.tinted()
    configuration.title = title
    configuration.subtitle = value
    configuration.image = UIImage(systemName: symbol)
    configuration.imagePadding = 12
    configuration.titlePadding = 3
    configuration.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14)
    configuration.baseForegroundColor = ink
    configuration.baseBackgroundColor = .secondarySystemFill
    configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var attributes = attributes
      attributes.font = UIFont.preferredFont(forTextStyle: .subheadline)
      return attributes
    }
    configuration.subtitleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var attributes = attributes
      attributes.font = UIFont.preferredFont(forTextStyle: .body)
      return attributes
    }
    button.configuration = configuration
    button.accessibilityLabel = title
    button.accessibilityValue = value
    button.accessibilityHint = title == "Tags" ? "Choose one or more tags, or create a tag." : "Choose a folder, or create a folder."
  }

  private func toggleTag(_ name: String) {
    if let index = selectedTags.firstIndex(where: { $0.caseInsensitiveCompare(name) == .orderedSame }) {
      selectedTags.remove(at: index)
    } else if selectedTags.count < 20 {
      selectedTags.append(name)
    }
    updateOrganizationButtons()
  }

  private func presentTagPrompt() {
    let alert = UIAlertController(title: "New tag", message: "Add a tag to this save. Up to 40 characters.", preferredStyle: .alert)
    alert.addTextField { field in field.placeholder = "Tag name"; field.autocapitalizationType = .sentences }
    let add = UIAlertAction(title: "Add", style: .default) { [weak self, weak alert] _ in
      guard let self, let value = alert?.textFields?.first?.text, let name = FoundkeepQueueScope.organizationName(value, limit: 40) else { return }
      if !self.selectedTags.contains(where: { $0.caseInsensitiveCompare(name) == .orderedSame }), self.selectedTags.count < 20 { self.selectedTags.append(name) }
      self.updateOrganizationButtons()
    }
    validateName(in: alert, action: add, limit: 40)
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(add)
    present(alert, animated: true)
  }

  private func presentFolderPrompt(name: String = "", error: String? = nil) {
    let alert = UIAlertController(title: "New folder", message: error ?? "Create a folder for this save. Requires a connection.", preferredStyle: .alert)
    alert.addTextField { field in field.placeholder = "Folder name"; field.text = name; field.autocapitalizationType = .sentences }
    let create = UIAlertAction(title: "Create", style: .default) { [weak self, weak alert] _ in
      guard let value = alert?.textFields?.first?.text, let name = FoundkeepQueueScope.organizationName(value, limit: 80) else { return }
      self?.createFolder(name: name)
    }
    validateName(in: alert, action: create, limit: 80)
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(create)
    present(alert, animated: true)
  }

  private func validateName(in alert: UIAlertController, action: UIAlertAction, limit: Int) {
    guard let field = alert.textFields?.first else { return }
    action.isEnabled = FoundkeepQueueScope.organizationName(field.text ?? "", limit: limit) != nil
    field.addAction(UIAction { [weak field, weak action] _ in
      action?.isEnabled = FoundkeepQueueScope.organizationName(field?.text ?? "", limit: limit) != nil
    }, for: .editingChanged)
  }

  private func createFolder(name: String) {
    guard let uploader, !isCreatingFolder, !isSaving else { return }
    isCreatingFolder = true
    saveButton.isEnabled = false
    cancelButton.isEnabled = false
    organizationLabel.text = "Creating \(name)…"
    updateOrganizationButtons()
    Task {
      do {
        let folder = try await uploader.createFolder(name: name)
        organization.folders.removeAll { $0.id == folder.id }
        organization.folders.append(folder)
        selectedFolder = folder
        requiresFolderReview = false
        folderMutationGeneration += 1
        organizationLabel.text = "This save will go in \(folder.name)."
      } catch {
        organizationLabel.text = "Folder creation needs a connection. Your save is still ready."
        presentFolderPrompt(name: name, error: "The folder could not be created. Check your connection and try again, or cancel to keep saving.")
      }
      isCreatingFolder = false
      cancelButton.isEnabled = true
      saveButton.isEnabled = !items.isEmpty && uploader.isConnected
      updateOrganizationButtons()
    }
  }

  private func loadItems() async {
    do {
      let loader = try ShareItemLoader()
      let uploader = try ShareUploader()
      self.loader = loader
      self.uploader = uploader
      if let cached = uploader.cachedOrganization { organization = cached }
      updateOrganizationButtons()
      if uploader.isConnected { Task { await loadOrganization() } }
      let input = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
      items = try await loader.load(input)
      itemStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
      for item in items.prefix(6) {
        let row = PaddedLabel()
        row.font = .preferredFont(forTextStyle: .subheadline)
        row.adjustsFontForContentSizeCategory = true
        row.textColor = ink
        row.numberOfLines = 2
        row.text = "\(symbol(item.type))  \(item.sourceTitle ?? item.fileName ?? item.selectionText?.prefix(70).description ?? item.type.capitalized)"
        row.backgroundColor = .secondarySystemGroupedBackground
        row.layer.cornerRadius = 8
        row.layer.masksToBounds = true
        itemStack.addArrangedSubview(row)
      }
      if items.count > 6 {
        let more = UILabel()
        configureLabel(more, text: "+ \(items.count - 6) more items")
        itemStack.addArrangedSubview(more)
      }
      if uploader.isConnected {
        statusLabel.text = FoundkeepSharePolicy.current.notice ?? (items.count == 1 ? "One item ready. Its source will stay attached." : "\(items.count) items ready. They will stay together in your collection.")
        saveButton.isEnabled = !isCreatingFolder && !isSaving
      } else {
        statusLabel.text = "Open FoundKeep once to connect this iPhone, then share again."
        openButton.isHidden = false
      }
    } catch {
      statusLabel.text = error.localizedDescription
      openButton.isHidden = false
    }
  }

  private func loadOrganization() async {
    guard let uploader else { return }
    let generation = folderMutationGeneration
    do {
      let fresh = try await uploader.loadOrganization()
      // A read begun before a successful creation cannot invalidate that new folder.
      guard generation == folderMutationGeneration else { return }
      organization = fresh
      if let selectedFolder, !fresh.folders.contains(where: { $0.id == selectedFolder.id }) {
        requiresFolderReview = true
        organizationLabel.text = "\(selectedFolder.name) is no longer available. Choose another folder or No folder to save."
      } else if !isCreatingFolder && !requiresFolderReview { organizationLabel.text = "Folder and tags apply to every item in this save." }
    } catch {
      if !isCreatingFolder && !requiresFolderReview { organizationLabel.text = "Couldn’t refresh folders. You can still save with the choices shown." }
    }
    updateOrganizationButtons()
  }

  @objc private func saveShare() {
    guard let uploader, !isSaving, !isCreatingFolder, !requiresFolderReview else { return }
    view.endEditing(true)
    isSaving = true
    saveButton.isEnabled = false
    cancelButton.isEnabled = false
    noteView.isEditable = false
    statusLabel.text = "Saving safely…"
    updateOrganizationButtons()
    let note = noteView.text ?? ""
    let folderId = selectedFolder?.id
    let userTags = selectedTags
    Task {
      do {
        let result = try await uploader.save(items, note: note, folderId: folderId, userTags: userTags)
        statusLabel.text = result.queued == 0 ? "Saved to your collection." : "Saved safely. \(result.queued) will upload when FoundKeep is online."
        try? await Task.sleep(nanoseconds: 450_000_000)
        extensionContext?.completeRequest(returningItems: nil)
      } catch {
        statusLabel.text = error.localizedDescription
        if case FoundkeepUploadError.folderNotFound = error {
          requiresFolderReview = true
          if let selectedFolder { organization.folders.removeAll { $0.id == selectedFolder.id } }
          organizationLabel.text = "Choose another folder or No folder, then save again."
        }
        isSaving = false
        saveButton.isEnabled = true
        cancelButton.isEnabled = true
        noteView.isEditable = true
        updateOrganizationButtons()
      }
    }
  }

  @objc private func cancelShare() {
    loader?.discard(items)
    extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
  }

  @objc private func openFoundkeep() {
    guard let url = URL(string: "\(Bundle.main.object(forInfoDictionaryKey: "FoundkeepScheme") as? String ?? "foundkeep")://") else { return }
    extensionContext?.open(url) { opened in
      if opened { self.extensionContext?.completeRequest(returningItems: nil) }
      else { self.statusLabel.text = "Open the FoundKeep app from your Home Screen, then return here." }
    }
  }

  func textViewDidChange(_ textView: UITextView) { notePlaceholder.isHidden = !textView.text.isEmpty }
  private func symbol(_ type: String) -> String { ["bookmark": "↗", "selection": "“", "image": "▧", "video": "▶", "audio": "♪", "document": "▤", "file": "□"][type] ?? "•" }
}
